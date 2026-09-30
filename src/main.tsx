import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted typefaces (latin subset only): exact editorial pairing,
// no third-party requests, nothing extra to download.
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';

import App from './app/App';

import './styles/tokens.css';
import './styles/globals.css';
import './styles/suggest.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// The static boot screen in index.html covered the wait for this very script.
// The app owns the viewport from here on — hand it over before React paints.
document.getElementById('boot')?.remove();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
