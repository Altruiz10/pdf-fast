import { zipSync } from 'fflate';
import { get, set, del } from 'idb-keyval';

export const isMobile = () => matchMedia('(pointer: coarse)').matches;

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export const readBytes = async (f: Blob) => new Uint8Array(await f.arrayBuffer());

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

export function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadPdf(bytes: Uint8Array, name: string) {
  download(pdfBlob(bytes), ensurePdf(name));
}

export const ensurePdf = (name: string) => (/\.pdf$/i.test(name) ? name : name + '.pdf');
export const baseName = (name: string) => name.replace(/\.pdf$/i, '');

export function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'a.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

export async function sharePdf(bytes: Uint8Array, name: string) {
  const file = new File([bytes as BlobPart], ensurePdf(name), { type: 'application/pdf' });
  await navigator.share({ files: [file], title: name });
}

type SaveHandle = { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> };
type Picker = (o: object) => Promise<SaveHandle>;

/** Desktop browsers with the File System Access API get a real "Save as" dialog; others download. */
export async function saveAs(bytes: Uint8Array, name: string) {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker && !isMobile()) {
    try {
      const handle = await picker({
        suggestedName: ensurePdf(name),
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const w = await handle.createWritable();
      await w.write(pdfBlob(bytes));
      await w.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  downloadPdf(bytes, name);
  return true;
}

export function downloadZip(files: { name: string; bytes: Uint8Array }[], zipName: string) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = f.bytes;
  download(new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' }), zipName);
}

export function printPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}

// ---------- crash recovery ----------

export interface Recovery {
  name: string;
  bytes: Uint8Array;
  annots: unknown[];
  savedAt: number;
}

const KEY = 'pdffast:recovery';

export async function writeRecovery(r: Recovery) {
  try {
    await set(KEY, r);
  } catch {
    /* storage unavailable (private mode) — recovery is best effort */
  }
}

export async function readRecovery(): Promise<Recovery | undefined> {
  try {
    return await get(KEY);
  } catch {
    return undefined;
  }
}

export async function clearRecovery() {
  try {
    await del(KEY);
  } catch {
    /* ignore */
  }
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** Parses "1,3,5-8" (1-based) into 0-based indices, in the order given. */
export function parseRanges(s: string, count: number): number[] {
  const out: number[] = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Intervalo inválido: "${part}"`);
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (a < 1 || b < 1 || a > count || b > count) throw new Error(`Página fora do documento: "${part}"`);
    const step = a <= b ? 1 : -1;
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i - 1);
  }
  return out;
}
