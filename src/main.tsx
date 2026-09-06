import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { trackScreenAngle } from './lib/portrait';
import './index.css';

/* Held in portrait on a phone whichever way it is turned — see `#root` in
   index.css. The turn itself is CSS, so it re-renders nothing and unmounts
   nothing: a session keeps its draft, its rest timer and its scroll position
   across it. This only records which way the phone went, which is the one
   thing a media query cannot say. */
trackScreenAngle();
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
