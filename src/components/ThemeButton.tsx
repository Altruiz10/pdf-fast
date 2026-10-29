import { Moon, Sun } from 'lucide-react';

export function ThemeButton({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button
      className="icon-btn theme-btn"
      onClick={toggle}
      title={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-pressed={dark}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
