import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useDoc } from '../store';
import { uid, type Annot, type PageSize } from '../lib/types';

interface Props {
  page: number;
  size: PageSize;
  annots: Annot[];
  editing: string | null;
  setEditing: (id: string | null) => void;
}

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; sx: number; sy: number; dx: number; dy: number };

export function translate(a: Annot, dx: number, dy: number): Annot {
  switch (a.type) {
    case 'line':
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'ink':
      return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

function resize(a: Annot, dx: number, dy: number): Annot {
  if ('w' in a) {
    if (a.type === 'image') {
      // keep aspect ratio for signatures/stamps
      const w = Math.max(10, a.w + dx);
      return { ...a, w, h: (a.h * w) / a.w };
    }
    return { ...a, w: Math.max(8, a.w + dx), h: Math.max(8, a.h + dy) };
  }
  return a;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, w: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = 6 + w * 3;
  return [-1, 1]
    .map((s) => {
      const t = ang + Math.PI + (s * Math.PI) / 7;
      return `M ${x2} ${y2} L ${x2 + len * Math.cos(t)} ${y2 + len * Math.sin(t)}`;
    })
    .join(' ');
}

export function AnnotLayer({ page, size, annots, editing, setEditing }: Props) {
  const { tool, setTool, style, selected, setSelected, doc, setAnnots } = useDoc();
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Annot | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const start = useRef<[number, number]>([0, 0]);

  const pt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * size.width) / r.width, ((e.clientY - r.top) * size.height) / r.height];
  };

  const all = doc?.annots ?? [];
  const create = (a: Annot) => setAnnots([...all, a], 'Adicionar comentário');
  const update = (a: Annot, label: string) => setAnnots(all.map((x) => (x.id === a.id ? a : x)), label);

  const drawing = tool !== 'select';

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drawing || e.button > 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = pt(e);
    start.current = [x, y];
    const base = { id: uid(), page, color: tool === 'highlight' ? highlightColor(style.color) : style.color };
    switch (tool) {
      case 'highlight':
      case 'rect':
      case 'ellipse':
      case 'redact':
        setDraft({ ...base, type: tool, x, y, w: 0, h: 0, width: style.width, color: tool === 'redact' ? '#000000' : base.color });
        break;
      case 'line':
      case 'arrow':
        setDraft({ ...base, type: tool, x1: x, y1: y, x2: x, y2: y, width: style.width });
        break;
      case 'ink':
        setDraft({ ...base, type: 'ink', points: [[x, y]], width: style.width });
        break;
      case 'text': {
        const a: Annot = { ...base, type: 'text', x, y, w: Math.min(220, size.width - x - 4), h: style.size * 2.4, text: '', size: style.size };
        create(a);
        setSelected(a.id);
        setEditing(a.id);
        setTool('select');
        break;
      }
      case 'note': {
        const a: Annot = { ...base, type: 'note', x: x - 9, y: y - 9, text: '', color: '#facc15' };
        create(a);
        setSelected(a.id);
        setEditing(a.id);
        setTool('select');
        break;
      }
    }
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag) {
      const [x, y] = pt(e);
      setDrag({ ...drag, dx: x - drag.sx, dy: y - drag.sy });
      return;
    }
    if (!draft) return;
    const [x, y] = pt(e);
    const [sx, sy] = start.current;
    if (draft.type === 'ink') setDraft({ ...draft, points: [...draft.points, [x, y]] });
    else if (draft.type === 'line' || draft.type === 'arrow') setDraft({ ...draft, x2: x, y2: y });
    else if ('w' in draft)
      setDraft({ ...draft, x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) });
  };

  const onUp = () => {
    if (drag) {
      const a = all.find((x) => x.id === drag.id);
      if (a && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5))
        update(drag.kind === 'move' ? translate(a, drag.dx, drag.dy) : resize(a, drag.dx, drag.dy), drag.kind === 'move' ? 'Mover comentário' : 'Redimensionar');
      setDrag(null);
      return;
    }
    if (!draft) return;
    const ok =
      draft.type === 'ink'
        ? draft.points.length > 1
        : draft.type === 'line' || draft.type === 'arrow'
          ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 3
          : 'w' in draft && draft.w > 3 && draft.h > 3;
    if (ok) create(draft);
    setDraft(null);
  };

  const beginDrag = (e: RPointerEvent, id: string, kind: Drag['kind']) => {
    if (drawing) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(id);
    svgRef.current?.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    setDrag({ kind, id, sx: x, sy: y, dx: 0, dy: 0 });
  };

  const shown = annots.map((a) => {
    if (drag && drag.id === a.id) return drag.kind === 'move' ? translate(a, drag.dx, drag.dy) : resize(a, drag.dx, drag.dy);
    return a;
  });

  return (
    <svg
      ref={svgRef}
      className={`annot-layer${drawing ? ' drawing' : ''}${drag ? ' dragging' : ''}`}
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        setDraft(null);
        setDrag(null);
      }}
    >
      {shown.map((a) => (
        <Shape
          key={a.id}
          a={a}
          selected={selected === a.id}
          editing={editing === a.id}
          onDown={(e) => beginDrag(e, a.id, 'move')}
          onResize={(e) => beginDrag(e, a.id, 'resize')}
          onEdit={() => setEditing(a.id)}
          onText={(text) => {
            setEditing(null);
            const cur = all.find((x) => x.id === a.id);
            if (!cur || !('text' in cur)) return;
            if (!text.trim()) setAnnots(all.filter((x) => x.id !== a.id), 'Remover comentário vazio');
            else if (text !== cur.text) update({ ...cur, text } as Annot, 'Editar texto');
          }}
        />
      ))}
      {draft && <Shape a={draft} selected={false} editing={false} />}
    </svg>
  );
}

/** Highlights read best in light, saturated tints. */
function highlightColor(c: string) {
  const map: Record<string, string> = { '#e11d48': '#fde047', '#000000': '#fde047' };
  return map[c] ?? c;
}

interface ShapeProps {
  a: Annot;
  selected: boolean;
  editing: boolean;
  onDown?: (e: RPointerEvent) => void;
  onResize?: (e: RPointerEvent) => void;
  onEdit?: () => void;
  onText?: (t: string) => void;
}

function Shape({ a, selected, editing, onDown, onResize, onEdit, onText }: ShapeProps) {
  const common = { onPointerDown: onDown, className: 'shape' } as const;
  let body: ReactNode;
  let box: { x: number; y: number; w: number; h: number } | null = null;

  switch (a.type) {
    case 'highlight':
      body = <rect {...common} x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} className="shape hl-shape" />;
      box = a;
      break;
    case 'rect':
      body = <rect {...common} x={a.x} y={a.y} width={a.w} height={a.h} fill="transparent" stroke={a.color} strokeWidth={a.width} />;
      box = a;
      break;
    case 'redact':
      body = <rect {...common} x={a.x} y={a.y} width={a.w} height={a.h} className="shape redact-shape" />;
      box = a;
      break;
    case 'ellipse':
      body = (
        <ellipse {...common} cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} fill="transparent" stroke={a.color} strokeWidth={a.width} />
      );
      box = a;
      break;
    case 'line':
    case 'arrow': {
      const d = `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}` + (a.type === 'arrow' ? ' ' + arrowHead(a.x1, a.y1, a.x2, a.y2, a.width) : '');
      body = (
        <g {...common}>
          <path d={d} stroke="transparent" strokeWidth={Math.max(12, a.width + 8)} fill="none" />
          <path d={d} stroke={a.color} strokeWidth={a.width} fill="none" strokeLinecap="round" />
        </g>
      );
      if (selected)
        box = { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
      break;
    }
    case 'ink': {
      const pts = a.points.map((p) => p.join(',')).join(' ');
      body = (
        <g {...common}>
          <polyline points={pts} stroke="transparent" strokeWidth={Math.max(12, a.width + 8)} fill="none" />
          <polyline points={pts} stroke={a.color} strokeWidth={a.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
      if (selected) {
        const xs = a.points.map((p) => p[0]);
        const ys = a.points.map((p) => p[1]);
        box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      break;
    }
    case 'text':
      body = (
        <foreignObject x={a.x} y={a.y} width={a.w} height={a.h} {...common} onDoubleClick={onEdit}>
          {editing ? (
            <textarea
              className="text-annot editing"
              style={{ color: a.color, fontSize: a.size }}
              defaultValue={a.text}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => onText?.(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
              placeholder="Digite aqui"
            />
          ) : (
            <div className="text-annot" style={{ color: a.color, fontSize: a.size }}>
              {a.text}
            </div>
          )}
        </foreignObject>
      );
      box = a;
      break;
    case 'note':
      body = (
        <g {...common} onDoubleClick={onEdit}>
          <rect x={a.x} y={a.y} width={18} height={18} rx={2} fill={a.color} stroke="#0006" strokeWidth={0.5} />
          <path d={`M ${a.x + 4} ${a.y + 6} h 10 M ${a.x + 4} ${a.y + 9} h 10 M ${a.x + 4} ${a.y + 12} h 7`} stroke="#333" strokeWidth={1} />
          {(editing || selected) && (
            <foreignObject x={a.x + 22} y={a.y} width={190} height={110} onPointerDown={(e) => e.stopPropagation()}>
              {editing ? (
                <textarea
                  className="note-pop"
                  defaultValue={a.text}
                  autoFocus
                  placeholder="Escreva o comentário"
                  onBlur={(e) => onText?.(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                />
              ) : (
                <div className="note-pop" onClick={onEdit}>
                  {a.text || <em>Toque para escrever</em>}
                </div>
              )}
            </foreignObject>
          )}
        </g>
      );
      break;
    case 'image':
      body = <image {...common} href={a.src} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none" />;
      box = a;
      break;
  }

  return (
    <g data-annot={a.id}>
      {body}
      {selected && box && (
        <>
          <rect className="sel-box" x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} />
          {'w' in a && onResize && (
            <rect className="sel-handle" x={box.x + box.w - 5} y={box.y + box.h - 5} width={10} height={10} onPointerDown={onResize} />
          )}
        </>
      )}
    </g>
  );
}
