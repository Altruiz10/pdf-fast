import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { useInstall } from '../lib/install';

const KEY = 'pdffast:install-dismissed';
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
};

/** Invites the user to install the app on first open; "Agora não" hides it for a week. */
export function InstallBanner() {
  const install = useInstall();
  const [visible, setVisible] = useState(false);
  const available = install.kind === 'prompt' || install.kind === 'ios';

  useEffect(() => {
    if (!available || snoozed()) return setVisible(false);
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [available]);

  if (!visible || !available) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <aside className="install-banner" role="dialog" aria-label="Instalar o aplicativo">
      <img src="./icon.svg" alt="" width={40} height={40} />
      <div className="install-text">
        <strong>Instale o PDF FAST</strong>
        {install.kind === 'ios' ? (
          <span>
            Toque em <Share size={14} aria-label="Compartilhar" /> e depois em <b>Adicionar à Tela de Início</b>.
          </span>
        ) : (
          <span>Abre mais rápido, funciona sem internet e fica na tela inicial.</span>
        )}
      </div>
      <div className="install-actions">
        {install.kind === 'prompt' && (
          <button
            className="btn primary"
            onClick={async () => {
              await install.install();
              setVisible(false);
            }}
          >
            <Download size={16} /> Instalar
          </button>
        )}
        <button className="btn ghost" onClick={dismiss}>
          Agora não
        </button>
      </div>
    </aside>
  );
}
