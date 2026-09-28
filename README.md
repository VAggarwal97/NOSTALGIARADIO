# Nostalgia Radio

A modern, single-screen public listening experience with an old Indian radio/cassette soul.
Vite + React + TypeScript · no login · no database · static CDN deploy.

Full product/UI/UX/security specification lives in the project documentation this build was
generated from. This repository is the implementation of it.

## Run

```bash
npm install
npm run demo:audio   # generates local sample audio used by `demo: true` stations
npm run dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run validate:content` | Content gate: unique IDs, valid categories, safe URL protocols, required fields, no executable markup |
| `npm run lint:security` | Same gate in `--strict` mode (warnings fail) |
| `npm test` | Vitest unit tests: URL safety, source policy, catalog/search/random |
| `npm run typecheck` | `tsc -b` |
| `npm run smoke` | Renders the real app to HTML through Vite SSR (runtime sanity) |
| `npm run build` | Validate → typecheck → Vite production build into `dist/` |
| `npm run ci` | The full gate: validate → test → typecheck → smoke → build |
| `npm run preview` | Serve the production build |
| `npm run demo:audio` | Regenerate `public/audio/demo-*.wav` (original synthesised material) |

## Project structure

```
scripts/                  CI content validation + demo audio generation
public/
  _headers                CSP / security headers (Cloudflare Pages, Netlify)
  manifest.webmanifest    installable app shell
  audio/                  locally generated sample tracks (no third-party audio)
src/
  app/App.tsx             single-screen shell + state orchestration
  components/             Header, CategoryRail, HeroStation, StationRail, StationCard,
                          NowPlaying, PlayerBar, SearchDialog, StationDrawer, Toast, Visualizer
  data/categories.ts      8 categories
  data/stations.ts        station inventory (replace with the full 746-line source)
  hooks/                  useAudioPlayer, useFavorites, useKeyboardShortcuts, useTheme
  lib/                    catalog, sourcePolicy, urlSafety, share, storage
  styles/                 tokens.css (design tokens) + globals.css (layout & components)
  types/station.ts        the data model
```

## Content: importing the full inventory

`src/data/stations.ts` is the only file that needs to change. Schema:

```ts
{
  id: 'musafir',              // unique, lowercase kebab-case — required even when names repeat
  name: 'Musafir',
  category: 'transit',        // home category, never 'mix'
  description: '…',
  url: 'https://…',           // station's own page (validated: http/https only)
  audioUrl: '/audio/…',       // required when action === 'play'
  action: 'play' | 'check',
  sourceType: 'direct-audio' | 'external-site' | 'embed',
  availability?: 'available' | 'unavailable' | 'unknown',
  rating?, ratingCount?, heat?, tags?, language?, region?, era?,
  featured?: true,            // appears in MIX
  demo?: true,                // ships with locally generated sample audio
}
```

Current state: 31 seed stations, 6 of them playable with locally generated sample audio.
Source pages are `https://example.org/…` placeholders — the validator warns (never fails) on
them so a real inventory paste goes straight through CI.

**Licensing rule enforced by design:** the app only plays `audioUrl` values that the project is
authorised to stream, opens external stations in a new tab, and shows *Check Station* rather than
faking playback for unavailable sources. No scraping, proxying or re-hosting.

## Security

- Baseline CSP in `index.html` (meta) and `public/_headers` (HTTP): `default-src 'self'`,
  `frame-src 'none'`, `object-src 'none'`, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, Permissions-Policy with camera/mic/
  location/payment disabled. HSTS is commented out until the domain is confirmed HTTPS-only.
- Every URL passes `src/lib/urlSafety.ts` before render or navigation
  (`javascript:`, `data:`, `blob:`, embedded credentials → rejected).
- `src/lib/sourcePolicy.ts` is the single decision point for play / open / check / blocked.
- External links use `target=_blank rel=noopener noreferrer`.
- Station metadata is rendered as text only — no `dangerouslySetInnerHTML` anywhere.
- Favourites, volume and theme live in `localStorage` under `nostalgia-radio:*` — IDs and
  preferences only. No accounts, no secrets, no `VITE_*` keys, no analytics.

## Accessibility & motion

- Every control keyboard-reachable with visible focus; `Space/K` play-pause, `←/→` station,
  `↑/↓` volume, `/` or `⌘/Ctrl+K` search, `F` favourite, `S` share, `R` surprise, `M` mute,
  `Esc` close.
- `aria-live` announcements on station change, `aria-label` on icon-only buttons,
  44px+ touch targets, no colour-only state.
- No autoplay without a user gesture; `prefers-reduced-motion` collapses all animation.

## Deploy

Static output in `dist/`. Any CDN works:

- **Cloudflare Pages / Netlify**: publish `dist/`, `_headers` is picked up automatically.
- **Vercel**: copy the `/*` block from `public/_headers` into `vercel.json` → `headers`.

Deep links are shareable and resolve to the same static app:
`/?station=purane-naghme&category=ambient`.
