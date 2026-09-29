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
  location: {
    href: 'http://localhost:5173/?station=musafir',
    search: '?station=musafir',
    origin: 'http://localhost:5173',
    pathname: '/',
  },
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
    ['renders hero artwork', html.includes('/art/highway.svg')],
    ['renders the station gallery in the hero', html.includes('station-grid') && html.includes('Explore the radio')],
    ['gallery lists the listening worlds', html.includes('Travel') && html.includes('Folk')],
    ['no category chips in the header', !html.includes('category-nav') && !html.includes('chip-indicator')],
    ['no fullscreen station menu', !html.includes('station-menu')],
    ['donate lives in the navbar', html.includes('nav-link-donate')],
    ['no technical tagline under the brand', !html.includes('brand-micro')],
    ['no donation page or modal', !html.includes('class="support"')],
    ['no provider iframe until a station configures one', !html.includes('engine-dock')],
    ['renders the live badge', html.includes('live-badge')],
    ['renders the two-line hero title', html.includes('line-2') || html.includes('hero-title')],
    ['renders keyboard hints', html.includes('Play / Pause') && html.includes('Mute')],
    ['renders the floating player', html.includes('Player controls')],
    ['no featured rail', !html.includes('Featured picks')],
    ['no station cards', !html.includes('class="card"')],
    ['no editorial sections', !html.includes('editorial')],
    ['no site footer', !html.includes('site-footer')],
    ['no sidebar markup', !html.includes('sidebar')],
    ['no login or account UI', !/sign ?up|register|avatar|profile/i.test(html)],
    // Presence fills this in after first paint — SSR must never invent a number.
    ['no hardcoded listener counts in SSR', !/\d+\s*(listening|listeners)/i.test(html)],
    ['renders the participate controls beside the player', html.includes('community-controls') && html.includes('suggest-btn')],
    ['rating aggregates stay honest until someone rates', !/\d+ ratings/.test(html) && html.includes('Be the first')],
    ['navbar links to the community page', html.includes('href="/suggest-music"')],
    ['no suggestion modal until it is asked for', !html.includes('dialog--suggest') && !html.includes('suggest-form')],
    ['the archive renders its seamless loop copy', (html.match(/class="station-card"/g) ?? []).length === 16],
    ['no station-level fake ratings', !/★\s*\d/.test(html)],
    ['no undefined leakage', !html.includes('undefined</')],
    ['no NaN leakage', !html.includes('NaN')],
  ];

  // Second view: the community request wall, rendered at its real path.
  windowStub.location.pathname = '/suggest-music';
  const suggestHtml = renderToString(createElement(App));
  windowStub.location.pathname = '/';

  // Third pass: the MIX flagship with no station deep link — its hero draws one
  // stage photo per page load (src/lib/backdrop.ts), plain and decorative.
  windowStub.location.href = 'http://localhost:5173/';
  windowStub.location.search = '';
  const stageHtml = renderToString(createElement(App));
  const stageChecks = [
    [
      'draws a real hero stage photo',
      /class="hero-art"\s+src="https:\/\/i\.pinimg\.com\/1200x\//.test(stageHtml),
    ],
    [
      'stage photo carries no invented alt text',
      /class="hero-art"[^>]*alt=""/.test(stageHtml),
    ],
  ];

  const suggestChecks = [
    ['renders the suggest page shell', suggestHtml.includes('suggest-page')],
    ['renders the community hero', /community radio/i.test(suggestHtml) && /your music/i.test(suggestHtml)],
    ['renders the request console', suggestHtml.includes('console-input')],
    ['renders how it works', /how it works/i.test(suggestHtml)],
    ['renders the community board heading', /what should play next/i.test(suggestHtml)],
    ['renders the ranking tabs', suggestHtml.includes('Most wanted') && suggestHtml.includes('Recently added')],
    ['no requests until the API returns them', suggestHtml.includes('Loading requests')],
    ['no fake vote counts in SSR', !/▲\s*\d/.test(suggestHtml)],
    ['the player stays on the suggest page', suggestHtml.includes('Player controls')],
    ['the home gallery is not on the suggest page', !suggestHtml.includes('station-grid')],
    ['no suggestion modal anywhere', !suggestHtml.includes('suggest-form') && !suggestHtml.includes('dialog--suggest')],
    ['no undefined leakage on the suggest page', !suggestHtml.includes('undefined</')],
    ['no NaN leakage on the suggest page', !suggestHtml.includes('NaN')],
  ];

  let failed = 0;
  for (const [name, ok] of [...checks, ...stageChecks, ...suggestChecks]) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`  rendered ${html.length} + ${suggestHtml.length} bytes of HTML`);

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
