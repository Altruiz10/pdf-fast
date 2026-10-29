// Copies runtime assets that pdf.js and qpdf load by URL into public/,
// so they are served (and cached by the service worker) for offline use.
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pdfjs = resolve(root, 'node_modules/pdfjs-dist');
const out = resolve(root, 'public/pdfjs');

mkdirSync(out, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(resolve(pdfjs, dir), resolve(out, dir), { recursive: true });
}
cpSync(
  resolve(root, 'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
  resolve(root, 'public/qpdf.wasm'),
);
console.log('assets copied to public/');
