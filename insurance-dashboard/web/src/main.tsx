import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import '@fontsource/heebo/hebrew-400.css';
import '@fontsource/heebo/hebrew-500.css';
import '@fontsource/heebo/hebrew-700.css';
import '@fontsource/heebo/latin-400.css';
import '@fontsource/heebo/latin-500.css';
import '@fontsource/heebo/latin-700.css';
import './styles.css';
import './styles/print.css';

// the installed app and return visits: shell and last data from the service worker (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });

// links shared before clean URLs (/#/company/harel) still land on their page
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
