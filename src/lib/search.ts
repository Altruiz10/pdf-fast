import type { PDFDocumentProxy } from './pdfjs';

export interface Match {
  page: number;
  /** [itemIndex, start, end] ranges inside the page's text items. */
  parts: [number, number, number][];
}

const fold = (c: string) => (c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || c)[0];

const cache = new WeakMap<PDFDocumentProxy, Promise<string[][]>>();

/** Text items per page, aligned with pdf.js TextLayer's text divs. */
export function pageItems(pdf: PDFDocumentProxy) {
  let p = cache.get(pdf);
  if (!p) {
    p = (async () => {
      const out: string[][] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        out.push(tc.items.filter((it) => 'str' in it).map((it) => (it as { str: string }).str));
      }
      return out;
    })();
    cache.set(pdf, p);
  }
  return p;
}

export async function findAll(pdf: PDFDocumentProxy, query: string): Promise<Match[]> {
  const q = [...query.trim()].map(fold).join('');
  if (!q) return [];
  const pages = await pageItems(pdf);
  const matches: Match[] = [];
  pages.forEach((items, page) => {
    // Concatenate items, remembering where each char came from.
    let text = '';
    const owner: [number, number][] = [];
    items.forEach((s, ii) => {
      for (let k = 0; k < s.length; k++) {
        text += fold(s[k]);
        owner.push([ii, k]);
      }
    });
    let from = 0;
    for (;;) {
      const at = text.indexOf(q, from);
      if (at < 0) break;
      const parts: Match['parts'] = [];
      for (let c = at; c < at + q.length; c++) {
        const [ii, k] = owner[c];
        const last = parts[parts.length - 1];
        if (last && last[0] === ii && last[2] === k) last[2] = k + 1;
        else parts.push([ii, k, k + 1]);
      }
      matches.push({ page, parts });
      from = at + q.length;
    }
  });
  return matches;
}

/** Wraps matched ranges of the given text layer divs in <mark>. */
export function paintMatches(divs: HTMLElement[], strs: string[], matches: Match[], current: Match | null) {
  const touched = new Map<number, { s: number; e: number; cur: boolean }[]>();
  for (const m of matches)
    for (const [ii, s, e] of m.parts) touched.set(ii, [...(touched.get(ii) ?? []), { s, e, cur: m === current }]);
  divs.forEach((div, ii) => {
    const ranges = touched.get(ii);
    const str = strs[ii] ?? '';
    if (!ranges) {
      if (div.dataset.marked) {
        div.textContent = str;
        delete div.dataset.marked;
      }
      return;
    }
    ranges.sort((a, b) => a.s - b.s);
    div.textContent = '';
    let pos = 0;
    for (const r of ranges) {
      if (r.s > pos) div.append(str.slice(pos, r.s));
      const mark = document.createElement('mark');
      mark.className = r.cur ? 'hl current' : 'hl';
      mark.textContent = str.slice(r.s, r.e);
      div.append(mark);
      pos = r.e;
    }
    if (pos < str.length) div.append(str.slice(pos));
    div.dataset.marked = '1';
  });
}
