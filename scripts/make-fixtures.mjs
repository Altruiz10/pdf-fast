// Builds small PDFs for manual testing: text, a rotated page, a form and an outline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFHexString, PDFNumber } from 'pdf-lib';

const out = resolve(import.meta.dirname, '../test-fixtures');
mkdirSync(out, { recursive: true });

const doc = await PDFDocument.create();
doc.setTitle('Documento de teste');
doc.setAuthor('PDF FAST');
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

for (let i = 1; i <= 5; i++) {
  const page = doc.addPage([595.28, 841.89]);
  page.drawText(`Capítulo ${i}`, { x: 60, y: 760, size: 28, font: bold, color: rgb(0.76, 0.25, 0.05) });
  const lines = [
    'Este é um parágrafo de exemplo para testar a busca, a seleção de texto',
    'e os destaques. A palavra contrato aparece aqui e em outras páginas.',
    `Página número ${i}. Informação confidencial: CPF 123.456.789-00.`,
    'Ação, coração, informação — acentos para testar a busca sem acento.',
  ];
  lines.forEach((t, k) => page.drawText(t, { x: 60, y: 700 - k * 22, size: 13, font }));
  page.drawRectangle({ x: 60, y: 300, width: 475, height: 220, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  page.drawText('Área de desenho', { x: 70, y: 500, size: 11, font, color: rgb(0.5, 0.5, 0.5) });
  if (i === 3) page.setRotation(degrees(90));
}

// Form on the last page
const form = doc.getForm();
const last = doc.getPage(4);
last.drawText('Nome:', { x: 60, y: 250, size: 12, font });
const name = form.createTextField('nome');
name.addToPage(last, { x: 120, y: 240, width: 250, height: 24 });
last.drawText('Aceito os termos:', { x: 60, y: 200, size: 12, font });
const cb = form.createCheckBox('aceito');
cb.addToPage(last, { x: 180, y: 195, width: 16, height: 16 });
const dd = form.createDropdown('estado');
dd.addOptions(['SP', 'RJ', 'MG', 'BA']);
dd.addToPage(last, { x: 120, y: 150, width: 100, height: 24 });

// Outline: one entry per chapter
const ctx = doc.context;
const root = ctx.nextRef();
const refs = doc.getPages().map(() => ctx.nextRef());
doc.getPages().forEach((p, i) => {
  const d = { Title: PDFHexString.fromText(`Capítulo ${i + 1}`), Parent: root, Dest: ctx.obj([p.ref, PDFName.of('Fit')]) };
  if (i) d.Prev = refs[i - 1];
  if (i < refs.length - 1) d.Next = refs[i + 1];
  ctx.assign(refs[i], ctx.obj(d));
});
ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(refs.length) }));
doc.catalog.set(PDFName.of('Outlines'), root);

writeFileSync(resolve(out, 'teste.pdf'), await doc.save());

const small = await PDFDocument.create();
const f2 = await small.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 2; i++) small.addPage([420, 595]).drawText(`Anexo ${i}`, { x: 40, y: 540, size: 24, font: f2 });
writeFileSync(resolve(out, 'anexo.pdf'), await small.save());
console.log('fixtures written');
