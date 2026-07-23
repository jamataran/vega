import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startServiceWorkerUpdates } from './lib/pwa';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se ha encontrado el contenedor #root.');

startServiceWorkerUpdates();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
