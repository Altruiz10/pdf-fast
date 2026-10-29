import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

const assetBase = new URL('./pdfjs/', document.baseURI).href;

/** Opens bytes with pdf.js. The bytes are copied because pdf.js takes ownership of the buffer. */
export function openPdf(bytes: Uint8Array, password?: string) {
  return pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/',
  }).promise;
}

export function isPasswordError(e: unknown): e is { code: number; name: string } {
  return !!e && (e as { name?: string }).name === 'PasswordException';
}

/** Renders a page into a new canvas at the given scale (CSS px per PDF point × pixel ratio). */
export async function renderToCanvas(page: PDFPageProxy, scale: number, canvas = document.createElement('canvas')) {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvas, viewport });
  await task.promise;
  return canvas;
}
