import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PortraitOnly } from './components/PortraitOnly';
import './index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
    {/* Outside the router on purpose: it has to cover the session screen and
        the loading state too, and it must not unmount anything when it shows. */}
    <PortraitOnly />
  </StrictMode>,
);
