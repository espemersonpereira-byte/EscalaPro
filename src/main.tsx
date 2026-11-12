import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Registra o Service Worker automaticamente no carregamento do app
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => {
        console.warn('Registro do Service Worker ignorado no ambiente atual:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
