import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openPdf, isPasswordError, type PDFDocumentProxy } from './lib/pdfjs';
import { flattenAnnots, normalizeForEditing } from './lib/pdfops';
import { encrypt } from './lib/qpdf';
import { clearRecovery, readBytes, saveAs, writeRecovery } from './lib/files';
import type { Annot, PageSize, Snapshot, Tool } from './lib/types';

const HISTORY_LIMIT = 30;

export interface Doc {
  name: string;
  bytes: Uint8Array;
  annots: Annot[];
  pdf: PDFDocumentProxy;
  sizes: PageSize[];
  version: number;
  /** Set when the file was opened with a password; saving re-encrypts with it unless turned off. */
  protection?: { password: string; keep: boolean };
}

export interface Busy {
  label: string;
  ratio?: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface Style {
  color: string;
  width: number;
  size: number;
}

interface Ctx {
  doc: Doc | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  busy: Busy | null;
  toasts: Toast[];
  tool: Tool;
  setTool: (t: Tool) => void;
  style: Style;
  setStyle: (s: Partial<Style>) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  jumpTo: { page: number; nonce: number } | null;
  goToPage: (p: number) => void;
  openFile: (file: File | { name: string; bytes: Uint8Array }, password?: string, initialAnnots?: Annot[]) => Promise<'ok' | 'password'>;
  closeDoc: () => void;
  commit: (bytes: Uint8Array, label: string, opts?: { keepAnnots?: boolean; annots?: Annot[] }) => Promise<void>;
  setAnnots: (annots: Annot[], label: string) => void;
  /** Flattens drawable annotations into the bytes (needed before structural page edits). */
  bakedBytes: () => Promise<Uint8Array>;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  finalBytes: () => Promise<Uint8Array>;
  run: <T>(label: string, fn: (progress: (ratio: number, label?: string) => void) => Promise<T>) => Promise<T | undefined>;
  toast: (text: string, kind?: Toast['kind']) => void;
  setProtection: (p: Doc['protection']) => void;
  pendingPassword: { name: string; bytes: Uint8Array; retry: boolean } | null;
  cancelPassword: () => void;
}

const DocContext = createContext<Ctx | null>(null);

export const useDoc = () => {
  const c = useContext(DocContext);
  if (!c) throw new Error('useDoc outside provider');
  return c;
};

async function pageSizes(pdf: PDFDocumentProxy) {
  const sizes: PageSize[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return sizes;
}

export function DocProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyleState] = useState<Style>({ color: '#e11d48', width: 2, size: 14 });
  const [selected, setSelected] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [jumpTo, setJumpTo] = useState<Ctx['jumpTo']>(null);
  const [pendingPassword, setPendingPassword] = useState<Ctx['pendingPassword']>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const run = useCallback<Ctx['run']>(
    async (label, fn) => {
      setBusy({ label });
      try {
        return await fn((ratio, l) => setBusy({ label: l ?? label, ratio }));
      } catch (e) {
        console.error(e);
        toast((e as Error).message || String(e), 'error');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const load = useCallback(async (bytes: Uint8Array) => {
    const pdf = await openPdf(bytes);
    return { pdf, sizes: await pageSizes(pdf) };
  }, []);

  const openFile = useCallback<Ctx['openFile']>(
    async (file, password, initialAnnots) => {
      const name = file.name;
      const raw = file instanceof Blob ? await readBytes(file) : file.bytes;
      // Probe with pdf.js first so we can ask for a password.
      try {
        const probe = await openPdf(raw, password);
        await probe.loadingTask.destroy();
      } catch (e) {
        if (isPasswordError(e)) {
          setPendingPassword({ name, bytes: raw, retry: password !== undefined });
          return 'password';
        }
        throw new Error('Não foi possível abrir este arquivo. Ele é um PDF válido?');
      }
      setPendingPassword(null);
      const { bytes, wasEncrypted } = await normalizeForEditing(raw, password);
      const { pdf, sizes } = await load(bytes);
      docRef.current?.pdf.loadingTask.destroy();
      setDoc({
        name,
        bytes,
        annots: initialAnnots ?? [],
        pdf,
        sizes,
        version: Date.now(),
        protection: wasEncrypted && password ? { password, keep: true } : undefined,
      });
      setPast([]);
      setFuture([]);
      setDirty(!!initialAnnots);
      setSelected(null);
      setTool('select');
      setCurrentPage(0);
      if (wasEncrypted && !password) toast('As restrições deste PDF foram removidas para permitir a edição.');
      return 'ok';
    },
    [load, toast],
  );

  const closeDoc = useCallback(() => {
    docRef.current?.pdf.loadingTask.destroy();
    setDoc(null);
    setPast([]);
    setFuture([]);
    setDirty(false);
    clearRecovery();
  }, []);

  const snapshot = (d: Doc, label: string): Snapshot => ({ bytes: d.bytes, annots: d.annots, label });
  const pushPast = (s: Snapshot) => setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), s]);

  const commit = useCallback<Ctx['commit']>(
    async (bytes, label, opts) => {
      const d = docRef.current;
      if (!d) return;
      const { pdf, sizes } = await load(bytes);
      pushPast(snapshot(d, label));
      setFuture([]);
      d.pdf.loadingTask.destroy();
      setDoc({ ...d, bytes, pdf, sizes, annots: opts?.annots ?? (opts?.keepAnnots ? d.annots : []), version: Date.now() });
      setSelected(null);
      setDirty(true);
    },
    [load],
  );

  const setAnnots = useCallback<Ctx['setAnnots']>((annots, label) => {
    const d = docRef.current;
    if (!d) return;
    pushPast(snapshot(d, label));
    setFuture([]);
    setDoc({ ...d, annots });
    setDirty(true);
  }, []);

  const restore = useCallback(
    async (s: Snapshot, from: Doc) => {
      if (s.bytes === from.bytes) {
        setDoc({ ...from, annots: s.annots });
        return;
      }
      const { pdf, sizes } = await load(s.bytes);
      from.pdf.loadingTask.destroy();
      setDoc({ ...from, bytes: s.bytes, annots: s.annots, pdf, sizes, version: Date.now() });
    },
    [load],
  );

  const undo = useCallback(() => {
    const d = docRef.current;
    const s = past[past.length - 1];
    if (!d || !s) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, snapshot(d, s.label)]);
    setSelected(null);
    setDirty(true);
    restore(s, d);
  }, [past, restore]);

  const redo = useCallback(() => {
    const d = docRef.current;
    const s = future[future.length - 1];
    if (!d || !s) return;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, snapshot(d, s.label)]);
    setSelected(null);
    setDirty(true);
    restore(s, d);
  }, [future, restore]);

  const bakedBytes = useCallback(async () => {
    const d = docRef.current!;
    if (d.annots.some((a) => a.type === 'redact'))
      throw new Error('Há tarjas de redação pendentes. Aplique-as (Ferramentas → Aplicar tarjas) ou remova-as antes.');
    return flattenAnnots(d.bytes, d.annots);
  }, []);

  const finalBytes = useCallback(async () => {
    const d = docRef.current!;
    let out = await flattenAnnots(d.bytes, d.annots);
    if (d.protection?.keep)
      out = await encrypt(out, {
        userPassword: d.protection.password,
        ownerPassword: d.protection.password,
        allowPrint: true,
        allowCopy: true,
        allowModify: true,
      });
    return out;
  }, []);

  const save = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    if (d.annots.some((a) => a.type === 'redact')) {
      toast('Atenção: as tarjas de redação ainda não foram aplicadas e não serão salvas. Use “Aplicar tarjas”.', 'error');
      return;
    }
    await run('Salvando…', async () => {
      const out = await finalBytes();
      if (await saveAs(out, d.name)) {
        setDirty(false);
        clearRecovery();
        toast('PDF salvo.', 'success');
      }
    });
  }, [finalBytes, run, toast]);

  const goToPage = useCallback((page: number) => {
    setJumpTo({ page, nonce: Math.random() });
    setCurrentPage(page);
  }, []);

  const setStyle = useCallback((s: Partial<Style>) => setStyleState((o) => ({ ...o, ...s })), []);
  const setProtection = useCallback((p: Doc['protection']) => {
    const d = docRef.current;
    if (d) setDoc({ ...d, protection: p });
  }, []);

  // Autosave for crash recovery: every minute while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const t = setInterval(() => {
      const d = docRef.current;
      if (d) writeRecovery({ name: d.name, bytes: d.bytes, annots: d.annots, savedAt: Date.now() });
    }, 60_000);
    return () => clearInterval(t);
  }, [dirty]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      const d = docRef.current;
      if (d) writeRecovery({ name: d.name, bytes: d.bytes, annots: d.annots, savedAt: Date.now() });
      e.preventDefault();
    };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [dirty]);

  const value = useMemo<Ctx>(
    () => ({
      doc,
      dirty,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past[past.length - 1]?.label,
      redoLabel: future[future.length - 1]?.label,
      busy,
      toasts,
      tool,
      setTool,
      style,
      setStyle,
      selected,
      setSelected,
      currentPage,
      setCurrentPage,
      jumpTo,
      goToPage,
      openFile,
      closeDoc,
      commit,
      setAnnots,
      bakedBytes,
      undo,
      redo,
      save,
      finalBytes,
      run,
      toast,
      setProtection,
      pendingPassword,
      cancelPassword: () => setPendingPassword(null),
    }),
    [doc, dirty, past, future, busy, toasts, tool, style, setStyle, selected, currentPage, jumpTo, goToPage, openFile, closeDoc, commit, setAnnots, bakedBytes, undo, redo, save, finalBytes, run, toast, setProtection, pendingPassword],
  );

  return <DocContext.Provider value={value}>{children}</DocContext.Provider>;
}
