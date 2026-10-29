import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Eraser, FilePlus2, ImagePlus, Trash2 } from 'lucide-react';
import { useDoc } from '../store';
import { Field, Modal } from './ui';
import {
  combine,
  extractPages,
  flattenAnnots,
  imagesToPdf,
  readMeta,
  sanitize,
  splitPdf,
  writeMeta,
  type Meta,
} from '../lib/pdfops';
import { encrypt, optimize } from '../lib/qpdf';
import { applyRedactions, ocrPages, rasterize } from '../lib/raster';
import { baseName, downloadPdf, downloadZip, formatBytes, parseRanges, pickFiles, readBytes } from '../lib/files';
import { uid, type BoxAnnot } from '../lib/types';

type Close = { onClose: () => void };

export function PasswordDialog() {
  const { pendingPassword, openFile, cancelPassword, run } = useDoc();
  const [pw, setPw] = useState('');
  if (!pendingPassword) return null;
  const submit = () => run('Abrindo…', () => openFile({ name: pendingPassword.name, bytes: pendingPassword.bytes }, pw));
  return (
    <Modal
      title="PDF protegido"
      onClose={cancelPassword}
      footer={
        <>
          <button className="btn" onClick={cancelPassword}>
            Cancelar
          </button>
          <button className="btn primary" onClick={submit}>
            Abrir
          </button>
        </>
      }
    >
      <p>
        <strong>{pendingPassword.name}</strong> precisa de senha para abrir.
      </p>
      {pendingPassword.retry && <p className="error-text">Senha incorreta. Tente novamente.</p>}
      <Field label="Senha">
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
    </Modal>
  );
}

export function CombineDialog({ onClose, initial }: Close & { initial?: { name: string; bytes: Uint8Array }[] }) {
  const { run, openFile } = useDoc();
  const [files, setFiles] = useState<{ id: string; name: string; bytes: Uint8Array }[]>(
    () => initial?.map((f) => ({ ...f, id: uid() })) ?? [],
  );
  const add = async () => {
    const picked = await pickFiles('application/pdf,.pdf', true);
    const read = await Promise.all(picked.map(async (f) => ({ id: uid(), name: f.name, bytes: await readBytes(f) })));
    setFiles((x) => [...x, ...read]);
  };
  const move = (i: number, d: number) =>
    setFiles((x) => {
      const n = [...x];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const go = (openAfter: boolean) =>
    run('Juntando PDFs…', async () => {
      const out = await combine(files);
      if (openAfter) await openFile({ name: 'Combinado.pdf', bytes: out });
      else downloadPdf(out, 'Combinado.pdf');
      onClose();
    });
  return (
    <Modal
      title="Juntar PDFs"
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={files.length < 2} onClick={() => go(false)}>
            Baixar
          </button>
          <button className="btn primary" disabled={files.length < 2} onClick={() => go(true)}>
            Juntar e abrir
          </button>
        </>
      }
    >
      <p className="muted">Os arquivos são unidos na ordem abaixo. Cada arquivo vira um marcador no resultado.</p>
      <ul className="file-list">
        {files.map((f, i) => (
          <li key={f.id}>
            <span className="file-name">{f.name}</span>
            <small>{formatBytes(f.bytes.length)}</small>
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
              <ArrowUp size={16} />
            </button>
            <button className="icon-btn" disabled={i === files.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
              <ArrowDown size={16} />
            </button>
            <button className="icon-btn" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label="Remover">
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block" onClick={add}>
        <FilePlus2 size={18} /> Adicionar arquivos
      </button>
    </Modal>
  );
}

export function SplitDialog({ onClose }: Close) {
  const { doc, run, bakedBytes } = useDoc();
  const [mode, setMode] = useState<'every' | 'before' | 'ranges'>('every');
  const [every, setEvery] = useState(1);
  const [before, setBefore] = useState('');
  const [ranges, setRanges] = useState('');
  if (!doc) return null;
  const n = doc.sizes.length;

  const groups = (): number[][] => {
    if (mode === 'every') {
      const g: number[][] = [];
      for (let i = 0; i < n; i += every) g.push(Array.from({ length: Math.min(every, n - i) }, (_, k) => i + k));
      return g;
    }
    if (mode === 'before') {
      const cuts = [...new Set(parseRanges(before, n))].filter((c) => c > 0).sort((a, b) => a - b);
      const bounds = [0, ...cuts, n];
      return bounds.slice(0, -1).map((s, k) => Array.from({ length: bounds[k + 1] - s }, (_, j) => s + j));
    }
    return ranges
      .split(/;|\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => parseRanges(r, n));
  };

  const go = () =>
    run('Dividindo…', async () => {
      const g = groups();
      if (!g.length) throw new Error('Nada para dividir.');
      const parts = await splitPdf(await bakedBytes(), g);
      const base = baseName(doc.name);
      const files = parts.map((bytes, k) => ({ name: `${base} - parte ${k + 1}.pdf`, bytes }));
      if (files.length === 1) downloadPdf(files[0].bytes, files[0].name);
      else downloadZip(files, `${base} (dividido).zip`);
      onClose();
    });

  return (
    <Modal
      title="Dividir PDF"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={go}>
          Dividir e baixar
        </button>
      }
    >
      <div className="radio-list">
        <label>
          <input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} /> A cada
          <input type="number" min={1} max={n} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value))} className="inline-num" /> páginas
        </label>
        <label>
          <input type="radio" checked={mode === 'before'} onChange={() => setMode('before')} /> Cortar antes das páginas
        </label>
        {mode === 'before' && <input placeholder="ex.: 3, 7" value={before} onChange={(e) => setBefore(e.target.value)} />}
        <label>
          <input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} /> Intervalos personalizados
        </label>
        {mode === 'ranges' && <input placeholder="ex.: 1-3; 4,6; 7-10" value={ranges} onChange={(e) => setRanges(e.target.value)} />}
      </div>
      <p className="muted">Documento com {n} páginas. Vários arquivos são baixados num .zip.</p>
    </Modal>
  );
}

export function ExtractDialog({ onClose }: Close) {
  const { doc, run, bakedBytes } = useDoc();
  const [r, setR] = useState('');
  if (!doc) return null;
  const go = () =>
    run('Extraindo…', async () => {
      const idx = parseRanges(r, doc.sizes.length);
      if (!idx.length) throw new Error('Informe as páginas.');
      downloadPdf(await extractPages(await bakedBytes(), idx), `${baseName(doc.name)} (${r.replace(/\s/g, '')}).pdf`);
      onClose();
    });
  return (
    <Modal title="Extrair páginas" onClose={onClose} footer={<button className="btn primary" onClick={go}>Extrair</button>}>
      <Field label="Páginas" hint={`Na ordem desejada, de 1 a ${doc.sizes.length}. Ex.: 1,3,5-8`}>
        <input autoFocus value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </Field>
    </Modal>
  );
}

export function ProtectDialog({ onClose }: Close) {
  const { doc, run, setProtection, toast } = useDoc();
  const [user, setUser] = useState('');
  const [owner, setOwner] = useState('');
  const [print, setPrint] = useState(true);
  const [copy, setCopy] = useState(true);
  const [modify, setModify] = useState(false);
  if (!doc) return null;
  const go = () =>
    run('Protegendo…', async () => {
      if (!user && !owner) throw new Error('Defina ao menos uma senha.');
      // Encrypt a plain copy, not one already re-encrypted with the original password.
      const plain = await flattenAnnots(doc.bytes, doc.annots);
      const out = await encrypt(plain, { userPassword: user, ownerPassword: owner || user, allowPrint: print, allowCopy: copy, allowModify: modify });
      downloadPdf(out, `${baseName(doc.name)} (protegido).pdf`);
      toast('PDF protegido baixado.', 'success');
      onClose();
    });
  return (
    <Modal title="Proteger com senha" onClose={onClose} footer={<button className="btn primary" onClick={go}>Proteger e baixar</button>}>
      <p className="muted">Criptografia AES-256. Uma cópia protegida é baixada; o documento aberto continua sem senha.</p>
      {doc.protection && (
        <label className="check">
          <input type="checkbox" checked={doc.protection.keep} onChange={(e) => setProtection({ ...doc.protection!, keep: e.target.checked })} />
          Manter a senha original ao salvar este documento
        </label>
      )}
      <Field label="Senha para abrir" hint="Quem não souber não consegue abrir o arquivo.">
        <input type="password" value={user} onChange={(e) => setUser(e.target.value)} />
      </Field>
      <Field label="Senha de permissões (opcional)" hint="Necessária para mudar as restrições abaixo.">
        <input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> Permitir imprimir
      </label>
      <label className="check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Permitir copiar texto
      </label>
      <label className="check">
        <input type="checkbox" checked={modify} onChange={(e) => setModify(e.target.checked)} /> Permitir editar
      </label>
    </Modal>
  );
}

export function PropertiesDialog({ onClose }: Close) {
  const { doc, run, commit, toast } = useDoc();
  const [meta, setMeta] = useState<(Meta & { pages: number; version: string }) | null>(null);
  useEffect(() => {
    if (doc) readMeta(doc.bytes).then(setMeta);
  }, [doc]);
  if (!doc || !meta) return null;
  const set = (k: keyof Meta) => (e: { target: { value: string } }) => setMeta({ ...meta, [k]: e.target.value });
  const save = () =>
    run('Salvando propriedades…', async () => {
      await commit(await writeMeta(doc.bytes, meta), 'Editar propriedades', { keepAnnots: true });
      toast('Propriedades atualizadas.', 'success');
      onClose();
    });
  const clean = () =>
    run('Limpando…', async () => {
      await commit(await sanitize(doc.bytes), 'Remover metadados', { keepAnnots: true });
      toast('Metadados, scripts e anexos removidos.', 'success');
      onClose();
    });
  const s = doc.sizes[0];
  return (
    <Modal
      title="Propriedades do documento"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={clean}>
            <Eraser size={16} /> Remover metadados
          </button>
          <button className="btn primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <dl className="facts">
        <div>
          <dt>Arquivo</dt>
          <dd>{doc.name}</dd>
        </div>
        <div>
          <dt>Tamanho</dt>
          <dd>{formatBytes(doc.bytes.length)}</dd>
        </div>
        <div>
          <dt>Páginas</dt>
          <dd>{meta.pages}</dd>
        </div>
        <div>
          <dt>Versão PDF</dt>
          <dd>{meta.version}</dd>
        </div>
        <div>
          <dt>Página 1</dt>
          <dd>
            {(s.width / 72 * 25.4).toFixed(0)} × {(s.height / 72 * 25.4).toFixed(0)} mm
          </dd>
        </div>
        <div>
          <dt>Senha</dt>
          <dd>{doc.protection ? 'Sim (aberto com senha)' : 'Não'}</dd>
        </div>
      </dl>
      <Field label="Título">
        <input value={meta.title} onChange={set('title')} />
      </Field>
      <Field label="Autor">
        <input value={meta.author} onChange={set('author')} />
      </Field>
      <Field label="Assunto">
        <input value={meta.subject} onChange={set('subject')} />
      </Field>
      <Field label="Palavras-chave" hint="Separadas por vírgula">
        <input value={meta.keywords} onChange={set('keywords')} />
      </Field>
      <Field label="Criador">
        <input value={meta.creator} onChange={set('creator')} />
      </Field>
      <Field label="Produtor">
        <input value={meta.producer} onChange={set('producer')} />
      </Field>
    </Modal>
  );
}

export function SignatureDialog({ onClose }: Close) {
  const { doc, currentPage, setAnnots, setSelected, setTool } = useDoc();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');
  const [color, setColor] = useState('#1e3a8a');
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
    const ctx = c.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
  }, [mode]);

  const pos = (e: RPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const place = () => {
    if (!doc) return;
    let src: string;
    let w: number;
    let h: number;
    if (mode === 'type') {
      if (!typed.trim()) return;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      const font = '96px "Dancing Script", "Segoe Script", "Brush Script MT", cursive';
      ctx.font = font;
      const m = ctx.measureText(typed);
      c.width = Math.ceil(m.width + 40);
      c.height = 150;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(typed, 20, 75);
      src = c.toDataURL('image/png');
      w = c.width;
      h = c.height;
    } else {
      const c = trim(canvas.current!);
      if (!c) return;
      src = c.toDataURL('image/png');
      w = c.width;
      h = c.height;
    }
    const size = doc.sizes[currentPage];
    const targetW = Math.min(180, size.width * 0.4);
    const targetH = (h / w) * targetW;
    const a = {
      id: uid(),
      type: 'image' as const,
      page: currentPage,
      color,
      x: (size.width - targetW) / 2,
      y: (size.height - targetH) / 2,
      w: targetW,
      h: targetH,
      src,
    };
    setAnnots([...doc.annots, a], 'Inserir assinatura');
    setTool('select');
    setSelected(a.id);
    onClose();
  };

  return (
    <Modal
      title="Assinatura"
      onClose={onClose}
      footer={
        <>
          {mode === 'draw' && (
            <button
              className="btn"
              onClick={() => {
                const c = canvas.current!;
                c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
                setHasInk(false);
              }}
            >
              Limpar
            </button>
          )}
          <button className="btn primary" disabled={mode === 'draw' ? !hasInk : !typed.trim()} onClick={place}>
            Inserir na página {currentPage + 1}
          </button>
        </>
      }
    >
      <div className="seg small">
        <button className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>
          Desenhar
        </button>
        <button className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>
          Digitar
        </button>
      </div>
      <div className="swatches">
        {['#1e3a8a', '#000000', '#0f766e'].map((c) => (
          <button key={c} className={`swatch-btn${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
      {mode === 'draw' ? (
        <canvas
          ref={canvas}
          className="sig-pad"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext('2d')!;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(...pos(e));
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            ctx.lineTo(...pos(e));
            ctx.stroke();
            setHasInk(true);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
      ) : (
        <input className="sig-typed" style={{ color }} placeholder="Seu nome" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
      )}
      <p className="muted">Depois de inserir, arraste para posicionar e use o canto para redimensionar. Esta é uma assinatura visual, não um certificado digital.</p>
    </Modal>
  );
}

/** Crops a canvas to its non-transparent pixels. */
function trim(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 8;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function OcrDialog({ onClose }: Close) {
  const { doc, run, commit, toast, bakedBytes } = useDoc();
  const [lang, setLang] = useState('por+eng');
  const [scope, setScope] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState('');
  const [skip, setSkip] = useState(true);
  const { currentPage } = useDoc();
  if (!doc) return null;
  const go = () =>
    run('Preparando OCR…', async (progress) => {
      const n = doc.sizes.length;
      const pages = scope === 'all' ? doc.sizes.map((_, i) => i) : scope === 'current' ? [currentPage] : parseRanges(range, n);
      const base = await bakedBytes();
      const { bytes, words } = await ocrPages(base, {
        pages,
        language: lang,
        skipPagesWithText: skip,
        onProgress: (msg, r) => progress(r, msg),
      });
      if (!words) {
        toast(skip ? 'Nenhum texto novo: as páginas já tinham texto ou nada foi reconhecido.' : 'Nenhum texto reconhecido.');
        return;
      }
      await commit(bytes, 'Reconhecer texto (OCR)');
      toast(`OCR concluído: ${words} palavras agora pesquisáveis.`, 'success');
      onClose();
    });
  return (
    <Modal title="Reconhecer texto (OCR)" onClose={onClose} footer={<button className="btn primary" onClick={go}>Iniciar</button>}>
      <p className="muted">
        Torna páginas escaneadas pesquisáveis e selecionáveis, adicionando uma camada de texto invisível. Roda no seu aparelho; na primeira vez o
        modelo do idioma (~10 MB) é baixado da internet.
      </p>
      <Field label="Idioma">
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="por+eng">Português + Inglês</option>
          <option value="por">Português</option>
          <option value="eng">Inglês</option>
          <option value="spa">Espanhol</option>
          <option value="fra">Francês</option>
          <option value="deu">Alemão</option>
          <option value="ita">Italiano</option>
        </select>
      </Field>
      <div className="radio-list">
        <label>
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Todas as páginas
        </label>
        <label>
          <input type="radio" checked={scope === 'current'} onChange={() => setScope('current')} /> Página atual ({currentPage + 1})
        </label>
        <label>
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} /> Páginas
        </label>
        {scope === 'range' && <input placeholder="ex.: 1-5, 8" value={range} onChange={(e) => setRange(e.target.value)} />}
      </div>
      <label className="check">
        <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Pular páginas que já têm texto
      </label>
    </Modal>
  );
}

export function ImagesDialog({ onClose }: Close) {
  const { run, openFile } = useDoc();
  const [imgs, setImgs] = useState<{ id: string; file: File; url: string }[]>([]);
  const [fit, setFit] = useState<'a4' | 'image'>('a4');
  useEffect(() => () => imgs.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line
  const add = async () => {
    const files = await pickFiles('image/*', true);
    setImgs((x) => [...x, ...files.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file) }))]);
  };
  const move = (i: number, d: number) =>
    setImgs((x) => {
      const n = [...x];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const go = (open: boolean) =>
    run('Criando PDF…', async () => {
      const out = await imagesToPdf(
        imgs.map((i) => i.file),
        fit,
      );
      if (open) await openFile({ name: 'Imagens.pdf', bytes: out });
      else downloadPdf(out, 'Imagens.pdf');
      onClose();
    });
  return (
    <Modal
      title="Imagens para PDF"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" disabled={!imgs.length} onClick={() => go(false)}>
            Baixar
          </button>
          <button className="btn primary" disabled={!imgs.length} onClick={() => go(true)}>
            Criar e abrir
          </button>
        </>
      }
    >
      <div className="img-grid">
        {imgs.map((im, i) => (
          <figure key={im.id}>
            <img src={im.url} alt="" />
            <figcaption>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Antes">
                <ArrowUp size={14} style={{ transform: 'rotate(-90deg)' }} />
              </button>
              <span>{i + 1}</span>
              <button className="icon-btn" disabled={i === imgs.length - 1} onClick={() => move(i, 1)} aria-label="Depois">
                <ArrowDown size={14} style={{ transform: 'rotate(-90deg)' }} />
              </button>
              <button className="icon-btn" onClick={() => setImgs((x) => x.filter((y) => y.id !== im.id))} aria-label="Remover">
                <Trash2 size={14} />
              </button>
            </figcaption>
          </figure>
        ))}
        <button className="img-add" onClick={() => add()}>
          <ImagePlus size={28} />
          Adicionar imagens
        </button>
      </div>
      <div className="seg small">
        <button className={fit === 'a4' ? 'on' : ''} onClick={() => setFit('a4')}>
          Página A4
        </button>
        <button className={fit === 'image' ? 'on' : ''} onClick={() => setFit('image')}>
          Tamanho da imagem
        </button>
      </div>
    </Modal>
  );
}

export function CompressDialog({ onClose }: Close) {
  const { doc, run, commit, toast, bakedBytes } = useDoc();
  const [level, setLevel] = useState<'lossless' | 'medium' | 'strong'>('lossless');
  if (!doc) return null;
  const go = () =>
    run('Otimizando…', async (progress) => {
      const before = doc.bytes.length;
      const base = await bakedBytes();
      const out =
        level === 'lossless'
          ? await optimize(base)
          : await rasterize(base, level === 'medium' ? 150 : 96, level === 'medium' ? 0.75 : 0.55, (d, t) => progress(d / t, `Página ${d} de ${t}`));
      if (out.length >= before && level === 'lossless') {
        toast('Este PDF já está otimizado; nada a reduzir sem perder qualidade.');
        return;
      }
      await commit(out, 'Reduzir tamanho');
      toast(`${formatBytes(before)} → ${formatBytes(out.length)} (${Math.round((1 - out.length / before) * 100)}% menor)`, 'success');
      onClose();
    });
  return (
    <Modal title="Reduzir tamanho" onClose={onClose} footer={<button className="btn primary" onClick={go}>Reduzir</button>}>
      <p className="muted">Tamanho atual: {formatBytes(doc.bytes.length)}</p>
      <div className="radio-list">
        <label>
          <input type="radio" checked={level === 'lossless'} onChange={() => setLevel('lossless')} />
          <span>
            <strong>Sem perdas</strong> — recompacta a estrutura; texto e imagens intactos.
          </span>
        </label>
        <label>
          <input type="radio" checked={level === 'medium'} onChange={() => setLevel('medium')} />
          <span>
            <strong>Média (150 dpi)</strong> — converte páginas em imagens. O texto deixa de ser selecionável.
          </span>
        </label>
        <label>
          <input type="radio" checked={level === 'strong'} onChange={() => setLevel('strong')} />
          <span>
            <strong>Forte (96 dpi)</strong> — menor arquivo, para envio rápido. O texto deixa de ser selecionável.
          </span>
        </label>
      </div>
    </Modal>
  );
}

export function RedactDialog({ onClose }: Close) {
  const { doc, run, commit, toast } = useDoc();
  if (!doc) return null;
  const boxes = doc.annots.filter((a): a is BoxAnnot => a.type === 'redact');
  const pages = [...new Set(boxes.map((b) => b.page + 1))];
  const go = () =>
    run('Aplicando tarjas…', async (progress) => {
      const out = await applyRedactions(doc.bytes, boxes, 150, (d, t) => progress(d / t, `Página ${d} de ${t}`));
      await commit(out, 'Aplicar tarjas', { annots: doc.annots.filter((a) => a.type !== 'redact') });
      toast('Tarjas aplicadas. O conteúdo coberto foi removido.', 'success');
      onClose();
    });
  return (
    <Modal
      title="Aplicar tarjas (redação)"
      onClose={onClose}
      footer={
        <button className="btn danger-fill" disabled={!boxes.length} onClick={go}>
          Aplicar {boxes.length} tarja{boxes.length === 1 ? '' : 's'}
        </button>
      }
    >
      {boxes.length ? (
        <>
          <p>
            As páginas <strong>{pages.join(', ')}</strong> serão convertidas em imagem (150 dpi) com as áreas marcadas pintadas de preto. Assim, o texto,
            as imagens e qualquer conteúdo escondido sob as tarjas são removidos de verdade — não apenas cobertos.
          </p>
          <p className="muted">Nessas páginas o texto deixa de ser selecionável. Você pode rodar o OCR depois para torná-lo pesquisável de novo.</p>
        </>
      ) : (
        <p>Nenhuma tarja marcada. Escolha a ferramenta “Tarja” e arraste sobre o que deseja esconder.</p>
      )}
    </Modal>
  );
}
