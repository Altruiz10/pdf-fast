import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Trash2, Search } from 'lucide-react';
import { useDoc } from '../store';
import { Thumbnail } from './Thumbnail';
import { FormsPanel } from './FormsPanel';
import type { Annot } from '../lib/types';

export type SideTab = 'pages' | 'outline' | 'comments' | 'forms';

interface OutlineNode {
  title: string;
  dest: unknown;
  url?: string | null;
  items: OutlineNode[];
}

export function Sidebar({ tab, setTab, labels, onNavigate }: { tab: SideTab; setTab: (t: SideTab) => void; labels: string[]; onNavigate?: () => void }) {
  const tabs: [SideTab, string][] = [
    ['pages', 'Páginas'],
    ['outline', 'Marcadores'],
    ['comments', 'Comentários'],
    ['forms', 'Formulário'],
  ];
  return (
    <aside className="sidebar">
      <div className="seg" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {tab === 'pages' && <Pages labels={labels} onNavigate={onNavigate} />}
        {tab === 'outline' && <Outline onNavigate={onNavigate} />}
        {tab === 'comments' && <Comments onNavigate={onNavigate} />}
        {tab === 'forms' && <FormsPanel />}
      </div>
    </aside>
  );
}

function Pages({ labels, onNavigate }: { labels: string[]; onNavigate?: () => void }) {
  const { doc, currentPage, goToPage } = useDoc();
  useEffect(() => {
    document.querySelector(`.thumb[data-i="${currentPage}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [currentPage]);
  if (!doc) return null;
  return (
    <div className="thumbs">
      {doc.sizes.map((s, i) => (
        <button
          key={i}
          data-i={i}
          className={`thumb${i === currentPage ? ' on' : ''}`}
          onClick={() => {
            goToPage(i);
            onNavigate?.();
          }}
        >
          <Thumbnail pdf={doc.pdf} version={doc.version} index={i} width={112} aspect={s.height / s.width} />
          <span>{labels[i] ?? i + 1}</span>
        </button>
      ))}
    </div>
  );
}

function Outline({ onNavigate }: { onNavigate?: () => void }) {
  const { doc, goToPage } = useDoc();
  const [items, setItems] = useState<OutlineNode[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!doc) return;
    doc.pdf.getOutline().then((o) => setItems((o as OutlineNode[] | null) ?? []));
  }, [doc]);

  const open = async (n: OutlineNode) => {
    if (!doc) return;
    if (n.url) return window.open(n.url, '_blank', 'noopener');
    let dest = n.dest;
    if (typeof dest === 'string') dest = await doc.pdf.getDestination(dest);
    if (!Array.isArray(dest)) return;
    const ref = dest[0];
    const idx = typeof ref === 'number' ? ref : await doc.pdf.getPageIndex(ref);
    goToPage(idx);
    onNavigate?.();
  };

  const filtered = useMemo(() => {
    if (!items) return null;
    const term = q.trim().toLowerCase();
    if (!term) return items;
    // Keep parents of matching entries so the hierarchy stays readable.
    const walk = (list: OutlineNode[]): OutlineNode[] =>
      list.flatMap((n) => {
        const kids = walk(n.items);
        return n.title.toLowerCase().includes(term) || kids.length ? [{ ...n, items: kids }] : [];
      });
    return walk(items);
  }, [items, q]);

  if (!filtered) return <p className="muted pad">Carregando…</p>;
  if (!items?.length) return <p className="muted pad">Este documento não tem marcadores.</p>;
  return (
    <div>
      <div className="side-search">
        <Search size={16} />
        <input placeholder="Filtrar marcadores" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <OutlineList nodes={filtered} open={open} forceOpen={!!q.trim()} />
    </div>
  );
}

function OutlineList({ nodes, open, forceOpen }: { nodes: OutlineNode[]; open: (n: OutlineNode) => void; forceOpen: boolean }) {
  return (
    <ul className="outline">
      {nodes.map((n, i) => (
        <OutlineItem key={i} n={n} open={open} forceOpen={forceOpen} />
      ))}
    </ul>
  );
}

function OutlineItem({ n, open, forceOpen }: { n: OutlineNode; open: (n: OutlineNode) => void; forceOpen: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const show = expanded || forceOpen;
  return (
    <li>
      <div className="outline-row">
        {n.items.length > 0 ? (
          <button className={`twisty${show ? ' open' : ''}`} onClick={() => setExpanded(!expanded)} aria-label={show ? 'Recolher' : 'Expandir'}>
            <ChevronRight size={14} />
          </button>
        ) : (
          <span className="twisty-space" />
        )}
        <button className="outline-title" onClick={() => open(n)}>
          {n.title}
        </button>
      </div>
      {show && n.items.length > 0 && <OutlineList nodes={n.items} open={open} forceOpen={forceOpen} />}
    </li>
  );
}

const TYPE_LABEL: Record<Annot['type'], string> = {
  highlight: 'Destaque',
  rect: 'Retângulo',
  ellipse: 'Elipse',
  redact: 'Tarja (pendente)',
  line: 'Linha',
  arrow: 'Seta',
  ink: 'Desenho',
  text: 'Caixa de texto',
  note: 'Nota',
  image: 'Assinatura / imagem',
};

function Comments({ onNavigate }: { onNavigate?: () => void }) {
  const { doc, goToPage, setSelected, selected, setAnnots } = useDoc();
  if (!doc) return null;
  const list = [...doc.annots].sort((a, b) => a.page - b.page);
  if (!list.length)
    return <p className="muted pad">Nenhum comentário ainda. Use as ferramentas de anotação para destacar, desenhar ou escrever.</p>;
  return (
    <ul className="comments">
      {list.map((a) => (
        <li key={a.id} className={selected === a.id ? 'on' : ''}>
          <button
            className="comment-main"
            onClick={() => {
              goToPage(a.page);
              setSelected(a.id);
              onNavigate?.();
            }}
          >
            <span className="swatch" style={{ background: a.color }} />
            <span>
              <strong>{TYPE_LABEL[a.type]}</strong>
              <small>Página {a.page + 1}</small>
              {'text' in a && a.text && <em>{a.text}</em>}
            </span>
          </button>
          <button className="icon-btn" aria-label="Excluir" onClick={() => setAnnots(doc.annots.filter((x) => x.id !== a.id), 'Excluir comentário')}>
            <Trash2 size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
