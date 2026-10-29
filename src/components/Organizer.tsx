import { useEffect, useState, type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, CheckSquare, FilePlus2, FileOutput, RotateCcw, RotateCw, Square, SquarePlus, Trash2, X } from 'lucide-react';
import { useDoc } from '../store';
import { Thumbnail } from './Thumbnail';
import { deletePages, extractPages, insertBlank, insertFrom, reorderPages, rotatePages } from '../lib/pdfops';
import { baseName, downloadPdf, pickFiles, readBytes } from '../lib/files';

export function Organizer({ onClose, labels }: { onClose: () => void; labels: string[] }) {
  const { doc, commit, run, bakedBytes, toast } = useDoc();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<number[]>([]);

  useEffect(() => {
    setOrder(doc ? doc.sizes.map((_, i) => i) : []);
    setSel(new Set());
  }, [doc?.version, doc]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!doc) return null;
  const count = doc.sizes.length;
  // `order` is reset in an effect, so for one render after a change it can be stale.
  const fresh = order.length === count && order.every((i) => i < count);
  const shown = fresh ? order : doc.sizes.map((_, i) => i);
  const selected = [...sel].filter((i) => i < count).sort((a, b) => a - b);

  const op = (label: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>) =>
    run(label + '…', async () => {
      await commit(await fn(await bakedBytes()), label);
    });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = shown.indexOf(+e.active.id);
    const to = shown.indexOf(+e.over.id);
    const next = arrayMove(shown, from, to);
    setOrder(next);
    op('Mover página', (b) => reorderPages(b, next));
  };

  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const targets = selected.length ? selected : null;
  const need = () => {
    if (!targets) toast('Selecione uma ou mais páginas primeiro.');
    return targets;
  };

  return (
    <div className="organizer">
      <div className="org-bar">
        <button className="btn ghost" onClick={onClose}>
          <Check size={18} /> Concluir
        </button>
        <span className="org-count">{selected.length ? `${selected.length} de ${count} selecionadas` : `${count} páginas`}</span>
        <div className="org-actions">
          <button className="btn ghost" onClick={() => setSel(selected.length === count ? new Set() : new Set(shown))} title="Selecionar todas">
            {selected.length === count ? <Square size={18} /> : <CheckSquare size={18} />}
            <span className="lbl">{selected.length === count ? 'Nenhuma' : 'Todas'}</span>
          </button>
          <button className="btn ghost" onClick={() => need() && op('Girar páginas', (b) => rotatePages(b, targets!, -90))} title="Girar à esquerda">
            <RotateCcw size={18} />
            <span className="lbl">Girar</span>
          </button>
          <button className="btn ghost" onClick={() => need() && op('Girar páginas', (b) => rotatePages(b, targets!, 90))} title="Girar à direita">
            <RotateCw size={18} />
          </button>
          <button
            className="btn ghost danger"
            onClick={() => need() && op(targets!.length > 1 ? 'Excluir páginas' : 'Excluir página', (b) => deletePages(b, targets!))}
            title="Excluir"
          >
            <Trash2 size={18} />
            <span className="lbl">Excluir</span>
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              const at = targets ? targets[targets.length - 1] + 1 : count;
              op('Inserir página em branco', (b) => insertBlank(b, at));
            }}
            title="Inserir página em branco"
          >
            <SquarePlus size={18} />
            <span className="lbl">Em branco</span>
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              const [f] = await pickFiles('application/pdf,.pdf');
              if (!f) return;
              const at = targets ? targets[targets.length - 1] + 1 : count;
              const other = await readBytes(f);
              op('Inserir páginas de arquivo', (b) => insertFrom(b, other, at));
            }}
            title="Inserir páginas de outro PDF"
          >
            <FilePlus2 size={18} />
            <span className="lbl">Inserir PDF</span>
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              need() &&
              run('Extraindo…', async () => {
                const out = await extractPages(await bakedBytes(), targets!);
                downloadPdf(out, `${baseName(doc.name)} (páginas ${targets!.map((i) => i + 1).join(',')}).pdf`);
              })
            }
            title="Extrair selecionadas para novo PDF"
          >
            <FileOutput size={18} />
            <span className="lbl">Extrair</span>
          </button>
          {selected.length > 0 && (
            <button className="btn ghost" onClick={() => setSel(new Set())} title="Limpar seleção">
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <p className="org-hint">Toque para selecionar. Arraste para reordenar (no celular, segure um instante antes de arrastar).</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown} strategy={rectSortingStrategy}>
          <div className="org-grid">
            {shown.map((i) => (
              <SortablePage key={i} id={i} selected={sel.has(i)} onToggle={() => toggle(i)} label={labels[i] ?? String(i + 1)}>
                <Thumbnail pdf={doc.pdf} version={doc.version} index={i} width={140} aspect={doc.sizes[i].height / doc.sizes[i].width} />
              </SortablePage>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortablePage({ id, selected, onToggle, label, children }: { id: number; selected: boolean; onToggle: () => void; label: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`org-item${selected ? ' on' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onToggle}
    >
      <div className="org-check">{selected ? <CheckSquare size={18} /> : <Square size={18} />}</div>
      {children}
      <span>{label}</span>
    </div>
  );
}
