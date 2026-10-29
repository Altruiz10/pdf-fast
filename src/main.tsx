import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import App from './App';
import { DocProvider } from './store';

registerSW({ immediate: true });

/** Shows a recoverable message instead of a blank screen if a render crashes. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Algo deu errado</h1>
        <p>{this.state.error.message}</p>
        <p className="muted">Suas alterações recentes ficam salvas para recuperação na tela inicial.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Recarregar
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <DocProvider>
        <App />
      </DocProvider>
    </Boundary>
  </StrictMode>,
);
