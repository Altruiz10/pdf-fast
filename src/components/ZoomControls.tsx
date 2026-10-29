import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Maximize, Minus, Plus } from 'lucide-react';
import type { ZoomMode } from './Viewer';

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

const PRESETS = [0.75, 1, 1.25, 1.5, 2, 3, 4];

interface Props {
  scale: number;
  mode: ZoomMode;
  onStep: (dir: 1 | -1) => void;
  onPreset: (scale: number) => void;
  onFit: (mode: 'fit-width' | 'fit-page') => void;
}

/** Floating text-size control: bigger/smaller buttons plus a menu with exact sizes and fit modes. */
export function ZoomControls({ scale, mode, onStep, onPreset, onFit }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="zoom-controls" ref={ref}>
      {open && (
        <div className="zoom-menu" role="menu">
          <button role="menuitemradio" aria-checked={mode === 'fit-width'} className={mode === 'fit-width' ? 'on' : ''} onClick={() => (onFit('fit-width'), setOpen(false))}>
            <ArrowRightLeft size={16} /> Ajustar à largura
          </button>
          <button role="menuitemradio" aria-checked={mode === 'fit-page'} className={mode === 'fit-page' ? 'on' : ''} onClick={() => (onFit('fit-page'), setOpen(false))}>
            <Maximize size={16} /> Página inteira
          </button>
          <hr />
          {PRESETS.map((p) => (
            <button
              key={p}
              role="menuitemradio"
              aria-checked={mode === 'custom' && Math.abs(scale - p) < 0.01}
              className={mode === 'custom' && Math.abs(scale - p) < 0.01 ? 'on' : ''}
              onClick={() => (onPreset(p), setOpen(false))}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      )}
      <button className="zc-btn" onClick={() => onStep(1)} aria-label="Aumentar texto" title="Aumentar (Ctrl +)">
        <Plus size={20} />
      </button>
      <button className="zc-val" onClick={() => setOpen(!open)} aria-label="Escolher tamanho" aria-expanded={open} title="Escolher tamanho">
        {Math.round(scale * 100)}%
      </button>
      <button className="zc-btn" onClick={() => onStep(-1)} aria-label="Diminuir texto" title="Diminuir (Ctrl -)">
        <Minus size={20} />
      </button>
    </div>
  );
}
