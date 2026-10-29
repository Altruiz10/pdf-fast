import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDoc } from '../store';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function BusyOverlay() {
  const { busy } = useDoc();
  if (!busy) return null;
  return (
    <div className="busy" role="status" aria-live="polite">
      <div className="busy-card">
        <div className="spinner" />
        <p>{busy.label}</p>
        {busy.ratio !== undefined && (
          <div className="progress">
            <div style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useDoc();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
