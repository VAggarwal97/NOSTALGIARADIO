/**
 * Smoke render: loads the real app through Vite's SSR pipeline and renders it to
 * string. Catches import errors, render-time crashes and module-scope side effects
 * without needing a browser. Used as a quick CI sanity check alongside the
 * content validator, typecheck and build.
 *
 * Usage: node scripts/smoke-render.mjs
 */
import { createServer } from 'vite';

const storage = new Map();
const localStorageStub = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

const documentStub = {
  documentElement: { dataset: {} },
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  title: 'Nostalgia Radio',
};

const windowStub = {
  localStorage: localStorageStub,
  location: { href: 'http://localhost:5173/?station=musafir', origin: 'http://localhost:5173', pathname: '/' },
  history: { replaceState: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  Audio: undefined,
};

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.localStorage = localStorageStub;
globalThis.history = windowStub.history;
globalThis.location = windowStub.location;
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { default: App } = await server.ssrLoadModule('/src/app/App.tsx');
  // react-dom/server is CJS — import it directly rather than through Vite.
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');

  const html = renderToString(createElement(App));
  const checks = [
    ['renders the brand', html.includes('Nostalgia Radio')],
    ['renders the hero station', html.includes('Musafir')],
    ['renders category rail', html.includes('Transit')],
    ['renders player controls', html.includes('Player controls')],
    ['no undefined leakage', !html.includes('undefined</')],
    ['no NaN leakage', !html.includes('NaN')],
    ['cards rendered', (html.match(/class="card"/g) ?? []).length > 0],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`  rendered ${html.length} bytes of HTML`);

  if (failed > 0) {
    console.error('  smoke render failed.');
    process.exitCode = 1;
  } else {
    console.log('  smoke render passed.');
  }
} catch (error) {
  console.error('  smoke render crashed:', error);
  process.exitCode = 1;
} finally {
  await server.close();
}
