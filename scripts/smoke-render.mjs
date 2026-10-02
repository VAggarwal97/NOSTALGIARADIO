/**
 * Smoke render: loads the real app through Vite's SSR pipeline and renders it to
 * string. Catches import errors, render-time crashes and module-scope side effects
 * without needing a browser. Used as a quick CI sanity check alongside the
 * content validator, typecheck and build.
 *
 * Usage: node scripts/smoke-render.mjs
 */
import { fileURLToPath } from 'node:url';

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

// The smoke render is deliberately an UNCONFIGURED app: it proves structure on
// the local request store whether or not `.env.local` exists. Neutralise the
// Supabase pair here — drop any process-env values and point envDir away from
// the repo root so no `.env*` file can leak in. A configured render only ever
// happens in a real browser (see usesSharedDatabase() in src/lib/request-api.ts).
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const server = await createServer({
  envDir: fileURLToPath(new URL('.', import.meta.url)),
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

  // Fourth pass: the control room. SSR never executes effects, so the admin
  // chunk never loads here — the route must render its loading line without
  // touching the public shell. The module is then rendered directly: with no
  // Supabase key in CI, the honest first screen is the not-configured state.
  // The shell renders too (dummy client — render must never query), proving
  // the panel opens straight into its sections with no sign-in anywhere.
  windowStub.location.pathname = '/admin';
  const adminRouteHtml = renderToString(createElement(App));
  windowStub.location.pathname = '/';

  const adminModule = await server.ssrLoadModule('/src/admin/AdminApp.tsx');
  const unconfiguredHtml = renderToString(createElement(adminModule.default));
  const renderOnlyClient = {
    from() {
      throw new Error('AdminShell queried the database during render');
    },
  };
  const shellHtml = renderToString(
    createElement(adminModule.AdminShell, { sb: renderOnlyClient }),
  );
  const allAdminHtml = unconfiguredHtml + shellHtml;

  const adminChecks = [
    ['routes /admin to the control room', adminRouteHtml.includes('Opening the control room')],
    [
      'no public shell at /admin',
      !adminRouteHtml.includes('station-grid') && !adminRouteHtml.includes('Player controls'),
    ],
    [
      'the public UI never links to the admin',
      !html.includes('href="/admin"') && !suggestHtml.includes('href="/admin"'),
    ],
    [
      'the admin app states its unconfigured state honestly',
      unconfiguredHtml.includes('Supabase is not configured'),
    ],
    [
      'the sign-in gate no longer exists in the module',
      typeof adminModule.AccessGate === 'undefined' &&
        typeof adminModule.AccessDenied === 'undefined' &&
        typeof adminModule.OtpEntry === 'undefined',
    ],
    [
      'the control room opens straight into its sections',
      /Open access/i.test(shellHtml) && shellHtml.includes('Dashboard'),
    ],
    ['no password or email field in the admin app', !/type="password"|type="email"/i.test(allAdminHtml)],
    ['no session chrome (sign out) anywhere', !/Sign out/i.test(allAdminHtml)],
    [
      'every section is reachable from the nav',
      ['Suggestions', 'Catalogue', 'Settings', 'Activity log'].every((label) =>
        shellHtml.includes(label),
      ),
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
  for (const [name, ok] of [...checks, ...stageChecks, ...suggestChecks, ...adminChecks]) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  console.log(
    `  rendered ${html.length} + ${suggestHtml.length} + ${adminRouteHtml.length} bytes of HTML`,
  );

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
