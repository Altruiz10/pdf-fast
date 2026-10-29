import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type DragEvent as RDragEvent } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Columns2,
  Download,
  Eraser,
  FileImage,
  FileLock2,
  FileOutput,
  FileSearch,
  Files,
  FolderOpen,
  Grid2x2,
  Highlighter,
  Home,
  Info,
  LayoutGrid,
  Maximize,
  Minimize2,
  Moon,
  MousePointer2,
  MoveRight,
  PanelLeft,
  PenLine,
  PenTool,
  Printer,
  Redo2,
  RotateCw,
  ScanText,
  Scissors,
  Search,
  Share2,
  Signature,
  Slash,
  Square,
  SquareDashed,
  StickyNote,
  Sun,
  Trash2,
  Type,
  Undo2,
  BookOpen,
  Command,
  X,
  RectangleVertical,
  Smartphone,
  History,
} from 'lucide-react';
import { useDoc } from './store';
import { Viewer, clampZoom, type ZoomApi, type ZoomMode } from './components/Viewer';
import { ZOOM_STEPS, ZoomControls } from './components/ZoomControls';
import { Sidebar, type SideTab } from './components/Sidebar';
import { Organizer } from './components/Organizer';
import { BusyOverlay, Modal, Toasts } from './components/ui';
import {
  CombineDialog,
  CompressDialog,
  ExtractDialog,
  ImagesDialog,
  OcrDialog,
  PasswordDialog,
  PropertiesDialog,
  ProtectDialog,
  RedactDialog,
  SignatureDialog,
  SplitDialog,
} from './components/Dialogs';
import { InstallBanner } from './components/InstallBanner';
import { ThemeButton } from './components/ThemeButton';
import { useInstall } from './lib/install';
import { findAll, type Match } from './lib/search';
import { canShareFiles, clearRecovery, pickFiles, printPdf, readRecovery, sharePdf, type Recovery } from './lib/files';
import { imagesToPdf, rotatePages } from './lib/pdfops';
import type { Annot, Tool } from './lib/types';

type DialogId = 'combine' | 'split' | 'extract' | 'protect' | 'props' | 'sign' | 'ocr' | 'images' | 'compress' | 'redact' | 'palette' | null;
type Layout = 'continuous' | 'single' | 'two-up';
type Theme = 'system' | 'light' | 'dark';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  run: () => void;
  needsDoc?: boolean;
  keys?: string;
}

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const isNarrow = () => innerWidth < 800;

export default function App() {
  const d = useDoc();
  const { doc, dirty, tool, setTool, style, setStyle, selected, setAnnots, run, toast, openFile } = d;
  const [dialog, setDialog] = useState<DialogId>(null);
  const [combineInitial, setCombineInitial] = useState<{ name: string; bytes: Uint8Array }[] | undefined>();
  const [organize, setOrganize] = useState(false);
  const [sidebar, setSidebar] = useState(!isNarrow());
  const [sideTab, setSideTab] = useState<SideTab>('pages');
  const [annotBar, setAnnotBar] = useState(false);
  const [scale, setScaleState] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');
  const [layout, setLayout] = useState<Layout>((store.get('pdffast:layout') as Layout) || 'continuous');
  const [theme, setTheme] = useState<Theme>((store.get('pdffast:theme') as Theme) || 'system');
  const [readMode, setReadMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<Recovery | undefined>();
  const install = useInstall();
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [dragOver, setDragOver] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const setScale = useCallback((s: number) => setScaleState(clampZoom(s)), []);

  const zoomApi = useRef<ZoomApi | null>(null);
  /** Next size up/down from the list of steps, around the centre of the screen. */
  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > scale * 1.02) : [...ZOOM_STEPS].reverse().find((s) => s < scale / 1.02);
    if (next) zoomApi.current?.zoomTo(next);
  };

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);
  const toggleTheme = useCallback(() => setTheme(isDark ? 'light' : 'dark'), [isDark]);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSystemDark(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    store.set('pdffast:theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1f1c1a' : '#c2410c');
  }, [theme, isDark]);
  useEffect(() => store.set('pdffast:layout', layout), [layout]);

  useEffect(() => {
    readRecovery().then(setRecovery);
    // Files opened through the installed app ("Open with PDF FAST").
    const lq = (window as unknown as { launchQueue?: { setConsumer: (f: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } }).launchQueue;
    lq?.setConsumer(async (p) => {
      const f = p.files[0];
      if (f) open(await f.getFile());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doc) return setLabels([]);
    doc.pdf.getPageLabels().then((l) => setLabels(l ?? []));
    document.title = `${doc.name} — PDF FAST`;
    return () => {
      document.title = 'PDF FAST';
    };
  }, [doc?.pdf, doc]);

  // Search as you type.
  useEffect(() => {
    if (!doc || !searchOpen) return setMatches([]);
    const t = setTimeout(async () => {
      const m = await findAll(doc.pdf, query);
      setMatches(m);
      const after = m.findIndex((x) => x.page >= d.currentPage);
      setMatchIdx(after < 0 ? 0 : after);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, doc?.pdf, searchOpen]);

  const current = matches[matchIdx] ?? null;
  useEffect(() => {
    if (current) d.goToPage(current.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const open = useCallback(
    (file: File) =>
      run('Abrindo…', async () => {
        if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
          if (file.type.startsWith('image/')) {
            const bytes = await imagesToPdf([file], 'a4');
            await openFile({ name: file.name.replace(/\.[^.]+$/, '') + '.pdf', bytes });
            return;
          }
          throw new Error('Escolha um arquivo PDF.');
        }
        await openFile(file);
        setOrganize(false);
        setSearchOpen(false);
        setZoomMode('fit-width');
        if (isNarrow()) setSidebar(false);
      }),
    [run, openFile],
  );

  const openPicker = async () => {
    const [f] = await pickFiles('application/pdf,.pdf');
    if (f) open(f);
  };

  const confirmDiscard = () => !dirty || confirm('Há alterações não salvas. Descartar?');

  const goHome = () => {
    if (!confirmDiscard()) return;
    d.closeDoc();
    setOrganize(false);
    setSearchOpen(false);
  };

  const rotateView = (delta: number) =>
    run('Girando…', async () => d.commit(await rotatePages(await d.bakedBytes(), [d.currentPage], delta), 'Girar página'));

  const share = () =>
    run('Preparando…', async () => {
      try {
        await sharePdf(await d.finalBytes(), doc!.name);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') throw e;
      }
    });

  const commands: Command[] = useMemo(
    () => [
      { id: 'open', label: 'Abrir PDF', group: 'Arquivo', icon: <FolderOpen size={18} />, run: openPicker, keys: 'Ctrl+O' },
      { id: 'save', label: 'Salvar / baixar', group: 'Arquivo', icon: <Download size={18} />, run: d.save, needsDoc: true, keys: 'Ctrl+S' },
      ...(canShareFiles() ? [{ id: 'share', label: 'Compartilhar', group: 'Arquivo', icon: <Share2 size={18} />, run: share, needsDoc: true }] : []),
      {
        id: 'print',
        label: 'Imprimir',
        group: 'Arquivo',
        icon: <Printer size={18} />,
        run: () => run('Preparando impressão…', async () => printPdf(await d.finalBytes())),
        needsDoc: true,
        keys: 'Ctrl+P',
      },
      { id: 'props', label: 'Propriedades e metadados', group: 'Arquivo', icon: <Info size={18} />, run: () => setDialog('props'), needsDoc: true },
      { id: 'combine', label: 'Juntar PDFs', group: 'Páginas', icon: <Files size={18} />, run: () => startCombine() },
      { id: 'organize', label: 'Organizar páginas', group: 'Páginas', icon: <LayoutGrid size={18} />, run: () => setOrganize(true), needsDoc: true },
      { id: 'split', label: 'Dividir PDF', group: 'Páginas', icon: <Scissors size={18} />, run: () => setDialog('split'), needsDoc: true },
      { id: 'extract', label: 'Extrair páginas', group: 'Páginas', icon: <FileOutput size={18} />, run: () => setDialog('extract'), needsDoc: true },
      { id: 'rotate', label: 'Girar página atual', group: 'Páginas', icon: <RotateCw size={18} />, run: () => rotateView(90), needsDoc: true },
      { id: 'images', label: 'Imagens para PDF', group: 'Criar', icon: <FileImage size={18} />, run: () => setDialog('images') },
      { id: 'annotate', label: 'Comentar e desenhar', group: 'Editar', icon: <PenLine size={18} />, run: () => setAnnotBar(true), needsDoc: true },
      { id: 'sign', label: 'Assinar', group: 'Editar', icon: <Signature size={18} />, run: () => setDialog('sign'), needsDoc: true },
      {
        id: 'forms',
        label: 'Preencher formulário',
        group: 'Editar',
        icon: <Grid2x2 size={18} />,
        run: () => {
          setSideTab('forms');
          setSidebar(true);
        },
        needsDoc: true,
      },
      { id: 'ocr', label: 'Reconhecer texto (OCR)', group: 'Editar', icon: <ScanText size={18} />, run: () => setDialog('ocr'), needsDoc: true },
      { id: 'compress', label: 'Reduzir tamanho', group: 'Editar', icon: <Minimize2 size={18} />, run: () => setDialog('compress'), needsDoc: true },
      {
        id: 'redact-tool',
        label: 'Marcar tarjas (redação)',
        group: 'Proteger',
        icon: <SquareDashed size={18} />,
        run: () => {
          setAnnotBar(true);
          setTool('redact');
        },
        needsDoc: true,
      },
      { id: 'redact', label: 'Aplicar tarjas', group: 'Proteger', icon: <Eraser size={18} />, run: () => setDialog('redact'), needsDoc: true },
      { id: 'protect', label: 'Proteger com senha', group: 'Proteger', icon: <FileLock2 size={18} />, run: () => setDialog('protect'), needsDoc: true },
      { id: 'search', label: 'Buscar no documento', group: 'Exibir', icon: <FileSearch size={18} />, run: () => openSearch(), needsDoc: true, keys: 'Ctrl+F' },
      { id: 'layout-c', label: 'Rolagem contínua', group: 'Exibir', icon: <RectangleVertical size={18} />, run: () => setLayout('continuous'), needsDoc: true },
      { id: 'layout-s', label: 'Uma página por vez', group: 'Exibir', icon: <Square size={18} />, run: () => setLayout('single'), needsDoc: true },
      { id: 'layout-2', label: 'Duas páginas lado a lado', group: 'Exibir', icon: <Columns2 size={18} />, run: () => setLayout('two-up'), needsDoc: true },
      { id: 'fit-w', label: 'Ajustar à largura', group: 'Exibir', icon: <ArrowRight size={18} />, run: () => setZoomMode('fit-width'), needsDoc: true },
      { id: 'fit-p', label: 'Página inteira', group: 'Exibir', icon: <Maximize size={18} />, run: () => setZoomMode('fit-page'), needsDoc: true },
      { id: 'read', label: 'Modo leitura', group: 'Exibir', icon: <BookOpen size={18} />, run: () => setReadMode(true), needsDoc: true },
      {
        id: 'fullscreen',
        label: 'Tela cheia',
        group: 'Exibir',
        icon: <Maximize size={18} />,
        run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      },
      {
        id: 'theme',
        label: isDark ? 'Tema claro' : 'Tema escuro',
        group: 'Exibir',
        icon: isDark ? <Sun size={18} /> : <Moon size={18} />,
        run: toggleTheme,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.save, d.finalBytes, d.bakedBytes, d.currentPage, isDark, doc],
  );

  const startCombine = (initial?: { name: string; bytes: Uint8Array }[]) => {
    setCombineInitial(initial ?? (doc ? [{ name: doc.name, bytes: doc.bytes }] : undefined));
    setDialog('combine');
  };

  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => searchInput.current?.select(), 0);
  };

  const step = (dir: number) => matches.length && setMatchIdx((i) => (i + dir + matches.length) % matches.length);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      const k = e.key.toLowerCase();
      if (mod && k === 'k') {
        e.preventDefault();
        setDialog(dialog === 'palette' ? null : 'palette');
      } else if (mod && k === 'o') {
        e.preventDefault();
        openPicker();
      } else if (!doc) return;
      else if (mod && k === 's') {
        e.preventDefault();
        d.save();
      } else if (mod && k === 'p') {
        e.preventDefault();
        commands.find((c) => c.id === 'print')?.run();
      } else if (mod && k === 'f') {
        e.preventDefault();
        openSearch();
      } else if (mod && k === 'g') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (typing) return;
      else if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        d.undo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        d.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        setAnnots(doc.annots.filter((a) => a.id !== selected), 'Excluir comentário');
      } else if (e.key === 'Escape') {
        if (readMode) setReadMode(false);
        else if (tool !== 'select') setTool('select');
        else if (searchOpen) setSearchOpen(false);
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stepZoom(1);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        stepZoom(-1);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setZoomMode('fit-width');
      } else if (layout === 'single' && (e.key === 'ArrowRight' || e.key === 'PageDown')) d.goToPage(Math.min(d.currentPage + 1, doc.sizes.length - 1));
      else if (layout === 'single' && (e.key === 'ArrowLeft' || e.key === 'PageUp')) d.goToPage(Math.max(d.currentPage - 1, 0));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // Drag & drop to open (desktop).
  const onDrop = (e: RDragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length > 1)
      Promise.all(pdfs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))).then((list) => startCombine(list));
    else if (files[0]) {
      if (!confirmDiscard()) return;
      open(files[0]);
    }
  };

  const restore = () =>
    run('Recuperando…', async () => {
      const r = recovery!;
      await openFile({ name: r.name, bytes: r.bytes }, undefined, r.annots as Annot[]);
      setRecovery(undefined);
      toast('Documento recuperado. Salve para não perder.', 'success');
    });

  const dialogs = (
    <>
      <PasswordDialog />
      {dialog === 'combine' && <CombineDialog onClose={() => setDialog(null)} initial={combineInitial} />}
      {dialog === 'split' && <SplitDialog onClose={() => setDialog(null)} />}
      {dialog === 'extract' && <ExtractDialog onClose={() => setDialog(null)} />}
      {dialog === 'protect' && <ProtectDialog onClose={() => setDialog(null)} />}
      {dialog === 'props' && <PropertiesDialog onClose={() => setDialog(null)} />}
      {dialog === 'sign' && <SignatureDialog onClose={() => setDialog(null)} />}
      {dialog === 'ocr' && <OcrDialog onClose={() => setDialog(null)} />}
      {dialog === 'images' && <ImagesDialog onClose={() => setDialog(null)} />}
      {dialog === 'compress' && <CompressDialog onClose={() => setDialog(null)} />}
      {dialog === 'redact' && <RedactDialog onClose={() => setDialog(null)} />}
      {dialog === 'palette' && <Palette commands={commands} hasDoc={!!doc} onClose={() => setDialog(null)} />}
      <InstallBanner />
      <BusyOverlay />
      <Toasts />
    </>
  );

  const dropProps = {
    onDragOver: (e: RDragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: (e: RDragEvent) => e.currentTarget === e.target && setDragOver(false),
    onDrop,
  };

  if (!doc)
    return (
      <div className={`home${dragOver ? ' drag' : ''}`} {...dropProps}>
        <div className="home-inner">
          <div className="brand">
            <img src="./icon.svg" alt="" width={56} height={56} />
            <div>
              <h1>PDF FAST</h1>
              <p>Leia, comente, assine e organize PDFs. Tudo no seu aparelho — nenhum arquivo sai dele.</p>
            </div>
            <ThemeButton dark={isDark} toggle={toggleTheme} />
          </div>
          <button className="drop" onClick={openPicker}>
            <FolderOpen size={36} />
            <strong>Abrir PDF</strong>
            <span>{matchMedia('(pointer: coarse)').matches ? 'Toque para escolher um arquivo' : 'ou arraste o arquivo para cá'}</span>
          </button>
          {recovery && (
            <div className="recovery">
              <History size={20} />
              <div>
                <strong>Alterações não salvas encontradas</strong>
                <span>
                  {recovery.name} · {new Date(recovery.savedAt).toLocaleString('pt-BR')}
                </span>
              </div>
              <button className="btn primary" onClick={restore}>
                Recuperar
              </button>
              <button
                className="icon-btn"
                aria-label="Descartar"
                onClick={() => {
                  clearRecovery();
                  setRecovery(undefined);
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <h2 className="section-title">Ferramentas</h2>
          <div className="tool-grid">
            <ToolCard icon={<Files />} title="Juntar PDFs" text="Una vários arquivos em um" onClick={() => startCombine([])} />
            <ToolCard icon={<FileImage />} title="Imagens para PDF" text="Fotos e digitalizações viram PDF" onClick={() => setDialog('images')} />
            <ToolCard icon={<PenTool />} title="Comentar e assinar" text="Destaques, notas, desenhos, assinatura" onClick={openPicker} />
            <ToolCard icon={<LayoutGrid />} title="Organizar páginas" text="Girar, excluir, reordenar, dividir" onClick={openPicker} />
            <ToolCard icon={<ScanText />} title="OCR" text="Torne digitalizações pesquisáveis" onClick={openPicker} />
            <ToolCard icon={<FileLock2 />} title="Senha e tarjas" text="Proteja e remova informações" onClick={openPicker} />
          </div>
          {install.kind === 'prompt' && (
            <button className="btn install" onClick={() => install.install()}>
              <Smartphone size={18} /> Instalar o app neste aparelho
            </button>
          )}
          <p className="foot">
            Atalhos: <kbd>Ctrl</kbd>+<kbd>K</kbd> todas as ferramentas · <kbd>Ctrl</kbd>+<kbd>O</kbd> abrir
          </p>
        </div>
        {dialogs}
      </div>
    );

  const pageCount = doc.sizes.length;
  const annotTools: [Tool, ReactNode, string][] = [
    ['select', <MousePointer2 size={18} />, 'Selecionar'],
    ['highlight', <Highlighter size={18} />, 'Destacar'],
    ['ink', <PenTool size={18} />, 'Caneta'],
    ['text', <Type size={18} />, 'Texto'],
    ['note', <StickyNote size={18} />, 'Nota'],
    ['rect', <Square size={18} />, 'Retângulo'],
    ['ellipse', <Circle size={18} />, 'Elipse'],
    ['line', <Slash size={18} />, 'Linha'],
    ['arrow', <MoveRight size={18} />, 'Seta'],
    ['redact', <SquareDashed size={18} />, 'Tarja'],
  ];
  const colors = ['#e11d48', '#f97316', '#fde047', '#16a34a', '#2563eb', '#7c3aed', '#000000'];
  const selAnnot = selected ? doc.annots.find((a) => a.id === selected) : undefined;
  const pendingRedactions = doc.annots.filter((a) => a.type === 'redact').length;

  return (
    <div className={`app${readMode ? ' read-mode' : ''}${dragOver ? ' drag' : ''}`} {...dropProps}>
      {!readMode && (
        <header className="topbar">
          <button className="icon-btn" onClick={goHome} title="Início" aria-label="Início">
            <Home size={20} />
          </button>
          {!organize && (
            <button className={`icon-btn hide-narrow${sidebar ? ' on' : ''}`} onClick={() => setSidebar(!sidebar)} title="Painel lateral" aria-label="Painel lateral">
              <PanelLeft size={20} />
            </button>
          )}
          <div className="doc-title" title={doc.name}>
            <span>{doc.name}</span>
            {dirty && <i className="dirty" title="Alterações não salvas" />}
          </div>
          <div className="spacer" />
          <button className="icon-btn" disabled={!d.canUndo} onClick={d.undo} title={d.undoLabel ? `Desfazer: ${d.undoLabel}` : 'Desfazer'} aria-label="Desfazer">
            <Undo2 size={20} />
          </button>
          <button className="icon-btn" disabled={!d.canRedo} onClick={d.redo} title={d.redoLabel ? `Refazer: ${d.redoLabel}` : 'Refazer'} aria-label="Refazer">
            <Redo2 size={20} />
          </button>
          <button className={`icon-btn${searchOpen ? ' on' : ''}`} onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())} title="Buscar (Ctrl+F)" aria-label="Buscar">
            <Search size={20} />
          </button>
          <button className={`icon-btn hide-narrow${annotBar ? ' on' : ''}`} onClick={() => setAnnotBar(!annotBar)} title="Comentar e desenhar" aria-label="Comentar">
            <PenLine size={20} />
          </button>
          <button className={`icon-btn hide-narrow${organize ? ' on' : ''}`} onClick={() => setOrganize(!organize)} title="Organizar páginas" aria-label="Organizar páginas">
            <LayoutGrid size={20} />
          </button>
          <button className="icon-btn hide-narrow" onClick={() => setDialog('palette')} title="Todas as ferramentas (Ctrl+K)" aria-label="Ferramentas">
            <Command size={20} />
          </button>
          <ThemeButton dark={isDark} toggle={toggleTheme} />
          <button className="btn primary save-btn" onClick={d.save} title="Salvar (Ctrl+S)">
            <Download size={18} />
            <span className="hide-narrow">Salvar</span>
          </button>
        </header>
      )}

      {searchOpen && !readMode && (
        <div className="searchbar">
          <Search size={16} />
          <input
            ref={searchInput}
            placeholder="Buscar no documento"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') setSearchOpen(false);
            }}
            enterKeyHint="search"
          />
          <span className="count">{query.trim() ? (matches.length ? `${matchIdx + 1} de ${matches.length}` : 'Nenhum') : ''}</span>
          <button className="icon-btn" disabled={!matches.length} onClick={() => step(-1)} aria-label="Anterior">
            <ChevronUp size={18} />
          </button>
          <button className="icon-btn" disabled={!matches.length} onClick={() => step(1)} aria-label="Próximo">
            <ChevronDown size={18} />
          </button>
          <button className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="Fechar busca">
            <X size={18} />
          </button>
        </div>
      )}

      {annotBar && !organize && !readMode && (
        <div className="annotbar" role="toolbar" aria-label="Ferramentas de comentário">
          <div className="tools">
            {annotTools.map(([t, icon, label]) => (
              <button key={t} className={`tool${tool === t ? ' on' : ''}`} onClick={() => setTool(t)} title={label} aria-label={label} aria-pressed={tool === t}>
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <button className="tool" onClick={() => setDialog('sign')} title="Assinatura">
              <Signature size={18} />
              <span>Assinar</span>
            </button>
          </div>
          <div className="tool-opts">
            {colors.map((c) => (
              <button
                key={c}
                className={`swatch-btn${style.color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setStyle({ color: c });
                  if (selAnnot && selAnnot.type !== 'redact' && selAnnot.type !== 'image')
                    setAnnots(doc.annots.map((a) => (a.id === selAnnot.id ? ({ ...a, color: c } as Annot) : a)), 'Mudar cor');
                }}
                aria-label={`Cor ${c}`}
              />
            ))}
            <select value={style.width} onChange={(e) => setStyle({ width: +e.target.value })} aria-label="Espessura" title="Espessura">
              {[1, 2, 3, 5, 8].map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
            <select value={style.size} onChange={(e) => setStyle({ size: +e.target.value })} aria-label="Tamanho do texto" title="Tamanho do texto">
              {[10, 12, 14, 18, 24, 32].map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
            {selAnnot && (
              <button className="btn ghost danger" onClick={() => setAnnots(doc.annots.filter((a) => a.id !== selAnnot.id), 'Excluir comentário')}>
                <Trash2 size={16} /> Excluir
              </button>
            )}
            {pendingRedactions > 0 && (
              <button className="btn danger-fill" onClick={() => setDialog('redact')}>
                <Eraser size={16} /> Aplicar {pendingRedactions} tarja{pendingRedactions > 1 ? 's' : ''}
              </button>
            )}
            <button className="icon-btn" onClick={() => (setAnnotBar(false), setTool('select'))} aria-label="Fechar ferramentas">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="workspace">
        {organize ? (
          <Organizer onClose={() => setOrganize(false)} labels={labels} />
        ) : (
          <>
            {sidebar && !readMode && (
              <>
                <div className="sheet-backdrop" onClick={() => setSidebar(false)} />
                <Sidebar tab={sideTab} setTab={setSideTab} labels={labels} onNavigate={() => isNarrow() && setSidebar(false)} />
              </>
            )}
            <Viewer
              scale={scale}
              setScale={setScale}
              zoomMode={zoomMode}
              setZoomMode={setZoomMode}
              matches={searchOpen ? matches : []}
              current={searchOpen ? current : null}
              layout={isNarrow() && layout === 'two-up' ? 'continuous' : layout}
              labels={labels}
              readMode={readMode}
              api={zoomApi}
            />
            <ZoomControls
              scale={scale}
              mode={zoomMode}
              onStep={stepZoom}
              onPreset={(s) => zoomApi.current?.zoomTo(s)}
              onFit={setZoomMode}
            />
            <div className="page-pill" aria-live="polite">
              {labels[d.currentPage] ?? d.currentPage + 1} / {pageCount}
            </div>
          </>
        )}
      </div>

      {readMode && (
        <button className="exit-read" onClick={() => setReadMode(false)}>
          <X size={16} /> Sair do modo leitura
        </button>
      )}

      {!readMode && !organize && (
        <nav className="bottombar">
          <button onClick={() => (setSideTab('pages'), setSidebar(!sidebar))} className={sidebar ? 'on' : ''}>
            <PanelLeft size={20} />
            <span>Páginas</span>
          </button>
          <button onClick={() => setAnnotBar(!annotBar)} className={annotBar ? 'on' : ''}>
            <PenLine size={20} />
            <span>Anotar</span>
          </button>
          <button onClick={() => setOrganize(true)}>
            <LayoutGrid size={20} />
            <span>Organizar</span>
          </button>
          <button onClick={() => setDialog('palette')}>
            <Command size={20} />
            <span>Ferramentas</span>
          </button>
        </nav>
      )}
      {dialogs}
    </div>
  );
}

function ToolCard({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button className="tool-card" onClick={onClick}>
      <span className="tool-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );
}

function Palette({ commands, hasDoc, onClose }: { commands: Command[]; hasDoc: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = commands.filter((c) => (!c.needsDoc || hasDoc) && fold(c.label).includes(fold(q)));
  const groups = [...new Set(list.map((c) => c.group))];
  const exec = (c: Command) => {
    onClose();
    c.run();
  };
  return (
    <Modal title="Todas as ferramentas" onClose={onClose} wide>
      <div className="palette-search">
        <Search size={18} />
        <input
          autoFocus={!matchMedia('(pointer: coarse)').matches}
          placeholder="O que você quer fazer?"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, list.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter' && list[active]) exec(list[active]);
          }}
        />
      </div>
      <div className="palette">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <div className="palette-grid">
              {list
                .filter((c) => c.group === g)
                .map((c) => (
                  <button key={c.id} className={`palette-item${list[active] === c ? ' active' : ''}`} onClick={() => exec(c)}>
                    {c.icon}
                    <span>{c.label}</span>
                    {c.keys && <kbd>{c.keys}</kbd>}
                  </button>
                ))}
            </div>
          </section>
        ))}
        {!list.length && <p className="muted">Nenhuma ferramenta encontrada.</p>}
      </div>
    </Modal>
  );
}
