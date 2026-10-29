import { PDFDocument, StandardFonts, PDFPage } from 'pdf-lib';
import { openPdf, renderToCanvas } from './pdfjs';
import { displayToPdfMatrix, load } from './pdfops';
import { concatTransformationMatrix, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import type { BoxAnnot } from './types';

const canvasToJpeg = (c: HTMLCanvasElement, q = 0.9) =>
  new Promise<Uint8Array>((res) =>
    c.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), 'image/jpeg', q),
  );

/** Replaces page `index` with a single full-page image of the same displayed size. */
async function replaceWithImage(doc: PDFDocument, index: number, jpeg: Uint8Array, w: number, h: number) {
  const img = await doc.embedJpg(jpeg);
  const page = doc.insertPage(index, [w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  doc.removePage(index + 1);
  return page;
}

/**
 * True redaction: every page that has redaction boxes is rendered to an image
 * with the boxes painted black, and the original page (its text, images and
 * hidden content) is replaced by that image. Nothing under the boxes survives.
 */
export async function applyRedactions(
  bytes: Uint8Array,
  boxes: BoxAnnot[],
  dpi = 150,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b);
  const pdf = await openPdf(bytes);
  const doc = await load(bytes);
  const scale = dpi / 72;
  let done = 0;
  for (const pi of pages) {
    const page = await pdf.getPage(pi + 1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderToCanvas(page, scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    for (const b of boxes.filter((x) => x.page === pi)) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    await replaceWithImage(doc, pi, await canvasToJpeg(canvas), vp.width, vp.height);
    onProgress?.(++done, pages.length);
  }
  await pdf.loadingTask.destroy();
  return doc.save({ useObjectStreams: true });
}

/** Rasterises pages to images (a "print to image" flatten). Used by compression at low quality. */
export async function rasterize(bytes: Uint8Array, dpi: number, quality: number, onProgress?: (d: number, t: number) => void) {
  const pdf = await openPdf(bytes);
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderToCanvas(page, dpi / 72);
    const img = await out.embedJpg(await canvasToJpeg(canvas, quality));
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    page.cleanup();
    onProgress?.(i, pdf.numPages);
  }
  await pdf.loadingTask.destroy();
  return out.save({ useObjectStreams: true });
}

export interface OcrOptions {
  pages: number[]; // 0-based
  language: string; // tesseract codes, e.g. 'por+eng'
  skipPagesWithText: boolean;
  onProgress?: (msg: string, ratio: number) => void;
}

/**
 * Adds an invisible, selectable and searchable text layer to scanned pages
 * using Tesseract. The page images are left untouched.
 */
export async function ocrPages(bytes: Uint8Array, opt: OcrOptions) {
  const { createWorker } = await import('tesseract.js');
  const pdf = await openPdf(bytes);
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  let current = 0;
  const worker = await createWorker(opt.language, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')
        opt.onProgress?.(`Reconhecendo página ${current + 1}`, (current + m.progress) / opt.pages.length);
      else opt.onProgress?.('Carregando modelo de idioma…', 0);
    },
  });
  const scale = 3; // ~216 dpi: good accuracy without exhausting phone memory
  let added = 0;
  try {
    for (let k = 0; k < opt.pages.length; k++) {
      current = k;
      const pi = opt.pages[k];
      const page = await pdf.getPage(pi + 1);
      if (opt.skipPagesWithText) {
        const tc = await page.getTextContent();
        if (tc.items.some((it) => 'str' in it && it.str.trim())) continue;
      }
      const canvas = await renderToCanvas(page, scale);
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const libPage: PDFPage = doc.getPage(pi);
      const { m, dispH: H } = displayToPdfMatrix(libPage);
      libPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
      for (const block of data.blocks ?? [])
        for (const par of block.paragraphs)
          for (const line of par.lines)
            for (const w of line.words) {
              const text = [...w.text].filter((c) => charset.has(c.codePointAt(0)!)).join('');
              if (!text.trim() || w.confidence < 30) continue;
              const x = w.bbox.x0 / scale;
              const width = (w.bbox.x1 - w.bbox.x0) / scale;
              const height = (line.bbox.y1 - line.bbox.y0) / scale;
              const base = line.baseline ? Math.max(line.baseline.y0, line.baseline.y1) / scale : w.bbox.y1 / scale;
              const natural = font.widthOfTextAtSize(text, 1);
              const size = Math.max(1, Math.min(width / natural, height * 1.2));
              libPage.drawText(text, { x, y: H - base, size, font, opacity: 0 });
              added++;
            }
      libPage.pushOperators(popGraphicsState());
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await pdf.loadingTask.destroy();
  }
  opt.onProgress?.('Concluído', 1);
  return { bytes: await doc.save({ useObjectStreams: true }), words: added };
}
