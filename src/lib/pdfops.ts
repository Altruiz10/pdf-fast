import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFDict,
  PDFRef,
  StandardFonts,
  BlendMode,
  LineCapStyle,
  degrees,
  rgb,
  concatTransformationMatrix,
  pushGraphicsState,
  popGraphicsState,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  PDFSignature,
  PDFButton,
  type PDFFont,
} from 'pdf-lib';
import type { Annot } from './types';
import { decrypt } from './qpdf';

export const A4 = { width: 595.28, height: 841.89 };

export async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

/**
 * Makes bytes editable by pdf-lib: removes encryption (qpdf) when present.
 * Returns the plain bytes and whether the input was encrypted.
 */
export async function normalizeForEditing(bytes: Uint8Array, password?: string) {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return { bytes, wasEncrypted: false };
  } catch (e) {
    if ((e as Error).name !== 'EncryptedPDFError' && !/encrypt/i.test(String(e))) throw e;
    return { bytes: await decrypt(bytes, password ?? ''), wasEncrypted: true };
  }
}

// ---------- page organisation ----------

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: number) {
  const doc = await load(bytes);
  for (const i of indices) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return save(doc);
}

export async function deletePages(bytes: Uint8Array, indices: number[]) {
  const doc = await load(bytes);
  if (indices.length >= doc.getPageCount()) throw new Error('Um PDF precisa ter pelo menos uma página.');
  for (const i of [...indices].sort((a, b) => b - a)) doc.removePage(i);
  return save(doc);
}

/** Reorders pages in place (keeps links, form fields and annotations attached). `order[k]` = old index of new page k. */
export async function reorderPages(bytes: Uint8Array, order: number[]) {
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  order.forEach((old, k) => doc.insertPage(k, pages[old]));
  return save(doc);
}

export async function insertBlank(bytes: Uint8Array, at: number, size?: { width: number; height: number }) {
  const doc = await load(bytes);
  const ref = doc.getPage(Math.min(Math.max(at - 1, 0), doc.getPageCount() - 1));
  const s = size ?? ref.getSize();
  doc.insertPage(at, [s.width, s.height]);
  return save(doc);
}

export async function insertFrom(bytes: Uint8Array, other: Uint8Array, at: number) {
  const doc = await load(bytes);
  const src = await load((await normalizeForEditing(other)).bytes);
  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((p, k) => doc.insertPage(at + k, p));
  return save(doc);
}

export async function extractPages(bytes: Uint8Array, indices: number[]) {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  copyInfo(src, out);
  return save(out);
}

export async function splitPdf(bytes: Uint8Array, groups: number[][]) {
  const out: Uint8Array[] = [];
  for (const g of groups) out.push(await extractPages(bytes, g));
  return out;
}

function copyInfo(src: PDFDocument, out: PDFDocument) {
  const t = src.getTitle();
  if (t) out.setTitle(t);
  const a = src.getAuthor();
  if (a) out.setAuthor(a);
}

/** Merges files, adding one top-level bookmark per source file. */
export async function combine(files: { name: string; bytes: Uint8Array }[]) {
  const out = await PDFDocument.create();
  const marks: { title: string; page: PDFRef }[] = [];
  for (const f of files) {
    const src = await load((await normalizeForEditing(f.bytes)).bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p, k) => {
      out.addPage(p);
      if (k === 0) marks.push({ title: f.name.replace(/\.pdf$/i, ''), page: p.ref });
    });
  }
  addOutline(out, marks);
  return save(out);
}

function addOutline(doc: PDFDocument, items: { title: string; page: PDFRef }[]) {
  if (!items.length) return;
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const dict: Record<string, unknown> = {
      Title: PDFHexString.fromText(it.title),
      Parent: rootRef,
      Dest: ctx.obj([it.page, PDFName.of('Fit')]),
    };
    if (i > 0) dict.Prev = refs[i - 1];
    if (i < items.length - 1) dict.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(dict as never));
  });
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(items.length) }),
  );
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

// ---------- metadata ----------

export interface Meta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export async function readMeta(bytes: Uint8Array): Promise<Meta & { pages: number; version: string }> {
  const doc = await load(bytes);
  const head = new TextDecoder().decode(bytes.slice(0, 16));
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    pages: doc.getPageCount(),
    version: head.match(/%PDF-(\d\.\d)/)?.[1] ?? '?',
  };
}

export async function writeMeta(bytes: Uint8Array, m: Meta) {
  const doc = await load(bytes);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setSubject(m.subject);
  doc.setKeywords(m.keywords ? m.keywords.split(/[,;]\s*/) : []);
  doc.setCreator(m.creator);
  doc.setProducer(m.producer);
  doc.setModificationDate(new Date());
  return save(doc);
}

/** Removes document info, XMP metadata, embedded JavaScript and attachments. */
export async function sanitize(bytes: Uint8Array) {
  const doc = await load(bytes);
  const info = doc.context.trailerInfo.Info;
  if (info) doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
  doc.catalog.delete(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('OpenAction'));
  doc.catalog.delete(PDFName.of('AA'));
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  names?.delete(PDFName.of('JavaScript'));
  names?.delete(PDFName.of('EmbeddedFiles'));
  return save(doc);
}

// ---------- images ----------

export async function imagesToPdf(images: Blob[], fit: 'image' | 'a4') {
  const doc = await PDFDocument.create();
  for (const blob of images) {
    const { bytes, type } = await toEmbeddable(blob);
    const img = type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    if (fit === 'image') {
      // 96 px per inch → points
      const w = (img.width * 72) / 96;
      const h = (img.height * 72) / 96;
      doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const landscape = img.width > img.height;
      const pw = landscape ? A4.height : A4.width;
      const ph = landscape ? A4.width : A4.height;
      const margin = 24;
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s;
      const h = img.height * s;
      doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return save(doc);
}

async function toEmbeddable(blob: Blob): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' }> {
  if (blob.type === 'image/jpeg') return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' };
  if (blob.type === 'image/png') return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
  // Other formats (webp, gif, bmp, heic where supported): re-encode through a canvas.
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const out = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
  return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'jpg' };
}

// ---------- forms ----------

export type FieldInfo =
  | { kind: 'text'; name: string; value: string; multiline: boolean; readOnly: boolean }
  | { kind: 'checkbox'; name: string; value: boolean; readOnly: boolean }
  | { kind: 'radio' | 'dropdown' | 'list'; name: string; value: string; options: string[]; readOnly: boolean }
  | { kind: 'other'; name: string; label: string };

export async function readFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const doc = await load(bytes);
  const form = doc.getForm();
  return form.getFields().map((f): FieldInfo => {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFTextField)
      return { kind: 'text', name, value: f.getText() ?? '', multiline: f.isMultiline(), readOnly };
    if (f instanceof PDFCheckBox) return { kind: 'checkbox', name, value: f.isChecked(), readOnly };
    if (f instanceof PDFRadioGroup)
      return { kind: 'radio', name, value: f.getSelected() ?? '', options: f.getOptions(), readOnly };
    if (f instanceof PDFDropdown)
      return { kind: 'dropdown', name, value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly };
    if (f instanceof PDFOptionList)
      return { kind: 'list', name, value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly };
    if (f instanceof PDFSignature) return { kind: 'other', name, label: 'Campo de assinatura' };
    if (f instanceof PDFButton) return { kind: 'other', name, label: 'Botão' };
    return { kind: 'other', name, label: 'Campo' };
  });
}

export async function fillFields(bytes: Uint8Array, values: Record<string, string | boolean>, flatten: boolean) {
  const doc = await load(bytes);
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f || f.isReadOnly()) continue;
    if (f instanceof PDFTextField) f.setText(String(v));
    else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
    else if (f instanceof PDFRadioGroup) (v ? f.select(String(v)) : f.clear());
    else if (f instanceof PDFDropdown || f instanceof PDFOptionList) (v ? f.select(String(v)) : f.clear());
  }
  if (flatten) form.flatten();
  return save(doc);
}

// ---------- annotations → page content ----------

function hex(c: string) {
  const n = parseInt(c.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Matrix taking "display space, y up" (origin bottom-left of the page as shown)
 * to PDF user space, for a page with the given crop box and rotation.
 */
export function displayToPdfMatrix(page: PDFPage) {
  const { x, y, width, height } = page.getCropBox();
  const x1 = x + width;
  const y1 = y + height;
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const dispH = swap ? width : height;
  const dispW = swap ? height : width;
  const m: [number, number, number, number, number, number] =
    r === 90 ? [0, 1, -1, 0, x1, y] : r === 180 ? [-1, 0, 0, -1, x1, y1] : r === 270 ? [0, -1, 1, 0, x, y1] : [1, 0, 0, 1, x, y];
  return { m, dispW, dispH };
}

function safeText(font: PDFFont, s: string) {
  const set = new Set(font.getCharacterSet());
  return [...s].map((ch) => (ch === '\n' || set.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

/** Draws the given annotations into the page content (they become part of the document). */
export async function flattenAnnots(bytes: Uint8Array, annots: Annot[]) {
  const drawable = annots.filter((a) => a.type !== 'redact');
  if (!drawable.length) return bytes;
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const byPage = new Map<number, Annot[]>();
  for (const a of drawable) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);

  for (const [pi, list] of byPage) {
    if (pi >= doc.getPageCount()) continue;
    const page = doc.getPage(pi);
    const { m, dispH: H } = displayToPdfMatrix(page);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
    for (const a of list) {
      const color = hex(a.color);
      switch (a.type) {
        case 'highlight':
          page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, color, opacity: 0.4, blendMode: BlendMode.Multiply });
          break;
        case 'rect':
          page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, borderColor: color, borderWidth: a.width });
          break;
        case 'ellipse':
          page.drawEllipse({ x: a.x + a.w / 2, y: H - a.y - a.h / 2, xScale: a.w / 2, yScale: a.h / 2, borderColor: color, borderWidth: a.width });
          break;
        case 'line':
        case 'arrow': {
          let d = `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
          if (a.type === 'arrow') {
            const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
            const len = 6 + a.width * 3;
            for (const s of [-1, 1]) {
              const t = ang + Math.PI + (s * Math.PI) / 7;
              d += ` M ${a.x2} ${a.y2} L ${a.x2 + len * Math.cos(t)} ${a.y2 + len * Math.sin(t)}`;
            }
          }
          page.drawSvgPath(d, { x: 0, y: H, borderColor: color, borderWidth: a.width, borderLineCap: LineCapStyle.Round });
          break;
        }
        case 'ink': {
          if (a.points.length < 2) break;
          const d = a.points.map(([px, py], i) => `${i ? 'L' : 'M'} ${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
          page.drawSvgPath(d, { x: 0, y: H, borderColor: color, borderWidth: a.width, borderLineCap: LineCapStyle.Round });
          break;
        }
        case 'text':
          page.drawText(safeText(font, a.text), {
            x: a.x + 2,
            y: H - a.y - a.size,
            size: a.size,
            font,
            color,
            lineHeight: a.size * 1.2,
            maxWidth: Math.max(a.w - 4, a.size),
          });
          break;
        case 'note': {
          page.drawRectangle({ x: a.x, y: H - a.y - 18, width: 18, height: 18, color, borderColor: rgb(0, 0, 0), borderWidth: 0.5, opacity: 0.9 });
          page.drawSvgPath(`M ${a.x + 4} ${a.y + 6} L ${a.x + 14} ${a.y + 6} M ${a.x + 4} ${a.y + 9} L ${a.x + 14} ${a.y + 9} M ${a.x + 4} ${a.y + 12} L ${a.x + 11} ${a.y + 12}`, {
            x: 0,
            y: H,
            borderColor: rgb(0.2, 0.2, 0.2),
            borderWidth: 1,
          });
          addTextAnnot(doc, page, m, H, a.x, a.y, a.text, a.color);
          break;
        }
        case 'image': {
          const png = await doc.embedPng(a.src);
          page.drawImage(png, { x: a.x, y: H - a.y - a.h, width: a.w, height: a.h });
          break;
        }
      }
    }
    page.pushOperators(popGraphicsState());
  }
  return save(doc);
}

/** Adds a real PDF sticky-note annotation so other readers show the comment text. */
function addTextAnnot(doc: PDFDocument, page: PDFPage, m: number[], H: number, x: number, y: number, text: string, color: string) {
  const tx = (px: number, py: number) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
  const [ax, ay] = tx(x, H - y - 18);
  const [bx, by] = tx(x + 18, H - y);
  const c = hex(color);
  const ref = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
      Contents: PDFHexString.fromText(text),
      Name: 'Comment',
      C: [c.red, c.green, c.blue],
      F: 4,
      Open: false,
      M: PDFHexString.fromText(new Date().toISOString()),
    }),
  );
  page.node.addAnnot(ref);
}
