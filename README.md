# Nostalgia Radio

A cinematic, single-page public listening experience with an old Indian radio/cassette soul.
Vite + React + TypeScript · one continuous scroll · no login · no database · static CDN deploy.

The product/UI/UX/security specification this build implements lives in the project
documentation it was generated from.

## The page (one scroll, no templates)

```
sticky top nav (brand · category chips · search / surprise / saved)
cinematic hero   → artwork-led, 40–96px editorial serif title, ONE dominant PLAY/ENTER CTA
floating player  → desktop: glass bar fixed at the bottom · mobile: compact bar → bottom sheet
FEATURED PICKS   → editorial rail of stations
editorial moment → one sentence, one atmospheric scene
<category> rail  → in-place crossfade when a category chip is pressed (never a new page)
editorial moment → specific to the active category
compact footer   → external links only
```

Deliberately absent: sidebars, logins, avatars, dashboards, notification/admin/analytics
widgets, filter panels, dense tables, fake listener numbers, decorative controls, autoplay.

## Run

```bash
npm install
npm run demo:audio   # local sample audio used by `demo: true` stations
npm run art          # regenerates the local SVG scene artwork in public/art/
npm run dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run art` | Regenerate `public/art/*.svg` (12 original procedural scenes) |
| `npm run validate:content` | Content gate: unique IDs, valid categories, artwork exists, safe URL protocols, required fields, no executable markup |
| `npm run lint:security` | Same gate in `--strict` mode (warnings fail) |
| `npm test` | Vitest: URL safety, source policy, catalog/search, spec invariants |
| `npm run typecheck` | `tsc -b` |
| `npm run smoke` | Renders the real app to HTML through Vite SSR (runtime sanity) |
| `npm run build` | Validate → typecheck → Vite production build into `dist/` |
| `npm run ci` | The full gate: validate → test → typecheck → smoke → build |
| `npm run preview` | Serve the production build |
| `npm run demo:audio` | Regenerate `public/audio/demo-*.wav` (original synthesised material) |

## Design system

Tokens live in `src/styles/tokens.css`; layout/components in `src/styles/globals.css`.

| Role | Value |
| --- | --- |
| Background | `#0B0807` |
| Surface | `#15100D` |
| Elevated | `#1D1511` |
| Ivory | `#F4EBDD` |
| Muted cream | `#CDBDA8` |
| Amber (primary accent) | `#D7A451` |
| Terracotta | `#A94A38` |
| Deep wine | `#4B1717` |
| Border | `#3A2A20` |
| Live | `#62D49B` |

Type is self-hosted (`@fontsource`, latin subset only — no third-party requests):
Cormorant Garamond (display/brand/hero), Inter (UI/body), IBM Plex Mono (metadata).

Motion: UI 180–300 ms, hero crossfade 500–900 ms, cards 150–220 ms; everything collapses
under `prefers-reduced-motion`.

Breakpoints: ≥1440 · 1024–1439 · 768–1023 · ≤767 (compact fixed player + bottom sheets).

## Project structure

```
scripts/                  CI validation, artwork + demo audio generation
public/
  _headers                CSP / security headers (Cloudflare Pages, Netlify)
  art/                    12 original SVG scenes (regenerate with `npm run art`)
  audio/                  locally generated sample tracks (no third-party audio)
  manifest.webmanifest    installable app shell
src/
  app/App.tsx             single-page shell + state orchestration
  components/             TopNav, CategoryNav, CinematicHero, FloatingPlayer, StationRail,
                          StationCard, EditorialMoment, SiteFooter, SearchOverlay,
                          StationInfoModal, Toast, Icons
  data/categories.ts      8 categories: MIX · TRAVEL · BEYOND · FOLK · AMBIENT ·
                          FESTIVALS · WORK · SHOP
  data/editorial.ts       editorial quotes per category
  data/stations.ts        station inventory (replace with the full source inventory)
  hooks/                  useAudioPlayer, useFavorites, useKeyboardShortcuts
  lib/                    catalog, sourcePolicy, urlSafety, share, storage
  styles/                 tokens.css (palette/type) + globals.css (layout & components)
  types/station.ts        the data model
```

## Content: importing the full inventory

`src/data/stations.ts` is the only file that needs to change. Schema:

```ts
{
  id: 'musafir',              // unique, lowercase kebab-case — required even when names repeat
  name: 'Musafir',
  category: 'transit',        // home category, never 'mix'
  secondaryCategories?: ['ambient'],
  description: '…',
  artwork: '/art/highway.svg', // local /art/*.svg — validated to exist on disk
  url: 'https://…',           // station's own page (validated: http/https only)
  audioUrl: '/audio/…',       // required when action === 'play'
  action: 'play' | 'check',
  sourceType: 'direct-audio' | 'external-site' | 'embed',
  status?: 'ready' | 'offline' | 'unknown',
  externalLinks?: [{ label: 'Spotify', url: 'https://…' }],  // rendered only when configured
  tags?, language?, region?, era?,
  featured?: true,            // appears in FEATURED PICKS
  demo?: true,                // ships with locally generated sample audio
  sortOrder?: number,         // derived from array order unless set
}
```

Ratings, listener counts, heat and progress fields are intentionally absent from the model —
the UI must never display invented data.

Current state: 31 seed stations, 6 of them playable with locally generated sample audio.
Source pages are `https://example.org/…` placeholders — the validator warns (never fails) on
them so a real inventory paste goes straight through CI.

**Licensing rule enforced by design:** the app only plays `audioUrl` values that the project is
authorised to stream, opens external stations in a new tab, and shows *Check* rather than
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
- Favourites and volume live in `localStorage` under `nostalgia-radio:*` — IDs and
  preferences only. No accounts, no secrets, no `VITE_*` keys, no analytics.

## Accessibility & motion

- Every control keyboard-reachable with visible focus; `Space/K` play-pause, `←/→` station,
  `↑/↓` volume, `/` or `⌘/Ctrl+K` search, `F` favourite, `S` share, `R` surprise, `M` mute,
  `Esc` close. Category switches never interrupt playback.
- `aria-live` announcements on station change, `aria-label` on icon-only buttons,
  44px+ touch targets, text + colour for every state, alt text on all artwork.
- Progress bars render only when a real duration exists — never simulated.
- No autoplay without a user gesture; `prefers-reduced-motion` collapses all animation.

## Deploy

Static output in `dist/`. Any CDN works:

- **Cloudflare Pages / Netlify**: publish `dist/`, `_headers` is picked up automatically.
- **Vercel**: copy the `/*` block from `public/_headers` into `vercel.json` → `headers`.

Deep links are shareable and resolve to the same static app:
`/?station=purane-naghme&category=ambient`.
