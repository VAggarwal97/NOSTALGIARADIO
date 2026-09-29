# Nostalgia Radio

A **single-screen cinematic radio experience** with an old Indian radio/cassette soul.
Vite + React + TypeScript · one page · no login · no database · static CDN deploy.

> **Design direction:** *"You opened a radio station, not a website containing radio
> stations."* The artwork is the page, the station identity is the hero, the player is the
> primary interaction, and everything else stays out of the way.

## The screen (one page, no templates)

```
┌──────────────────────────────────────────────────────────────────────┐
│ NOSTALGIA RADIO                          ♪ 𝘈   DONATE   ?   ⌕        │
│                                                                      │
│  ● ON AIR                         ┌ EXPLORE THE RADIO ────────────┐  │
│  TRAVEL · ROAD · PEOPLE · MEMORIES │ MIX   TRAVEL  BEYOND  FOLK    │  │
│  Truck Wala                        │ AMBIENT FESTIVALS WORK  SHOP  │  │
│  Radio                             │ All 37 stations →             │  │
│  Highway bangers, desi beats and   └──────────────────────────────┘  │
│  trucker tales from India's long roads…            ← artwork behind  │
│  ⌖ Highway · Hindi · 1990s–2000s                                     │
│  [ ▶ PLAY ]  [ SURPRISE ME ]  ⋯                                       │
│                                                                      │
│        SPACE Play/Pause   ← → Seek   M Mute   S Share   ? Help       │
│                                                                      │
│      ╭──────────────── glass pill player ─────────────────╮          │
│      │ (ART)  Demo Tape A · Playing · Truck Wala Radio     │          │
│      │        ◀  ❚❚  ▶   🔊  ☰  ⌄                       │          │
│      │        ──────────●──────────            00:12/03:00 │          │
│      ╰─────────────────────────────────────────────────────╯          │
└──────────────────────────────────────────────────────────────────────┘
```

- **Header is a utility bar, not navigation**: brand → Spotify / YouTube Music (shown only
  when the station configures them) · **Donate** · help · search. No category links — they
  moved into the hero.
- **The category gallery lives inside the hero.** The right side of the hero is a floating
  wall of miniature posters — one card per listening world (artwork, name, one-line tagline,
  `region · language · era`, status). Pressing TRAVEL swaps the hero to that category's
  flagship station — artwork, two-line title, copy, metadata, accent and track all crossfade.
  Same screen, same layout, nothing navigates, nothing reloads. On mobile the gallery
  becomes a horizontal snap rail under the station copy — never a sidebar or hamburger menu.
- **Hero** ≈ 100vh: cinematic artwork, dark multi-layer scrim, grain, a non-numeric live badge,
  editorial serif title (line 2 in the station accent), short description, `⌖ region · language ·
  era`, one dominant CTA, **Surprise me**, subtle keyboard hints.
- **Floating glass player**: pill (720px max, backdrop blur, soft shadow) with circular
  artwork, track/station, transport, volume, a real queue of the current station set, and a
  progress line that renders **only** when the audio reports a real duration. It can minimise
  into a small `◉ Now Playing` chip. Mobile: compact rounded bar → expands in place.
- **Donate is a reserved slot, not a flow (V1)**: a navbar button pointing at a configurable
  destination (`src/data/donate.ts`, currently the `#` placeholder). No donation page, form or
  payment code — swap the `href` when the real link exists.
- **Overlays only**: search, station details, keyboard help, toasts.

Deliberately absent: rails/grids of cards, category sections, footer blocks, sidebars,
category pages, logins, avatars, wishlists, dashboards, notifications, admin/analytics
widgets, filter panels, dense tables, fake listener counts or progress, decorative controls,
autoplay.

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
| `npm run validate:content` | Content gate: unique IDs, valid categories, flagship per category (exists · marked · two-line title · accent), artwork on disk, safe URL protocols, required fields, no executable markup |
| `npm run lint:security` | Same gate in `--strict` mode (warnings fail) |
| `npm test` | Vitest: URL safety, source policy, catalog/search, spec invariants |
| `npm run typecheck` | `tsc -b` |
| `npm run smoke` | Renders the real app to HTML through Vite SSR and asserts the single-screen structure |
| `npm run build` | Validate → typecheck → Vite production build into `dist/` |
| `npm run ci` | The full gate: validate → test → typecheck → smoke → build |
| `npm run preview` | Serve the production build |
| `npm run demo:audio` | Regenerate `public/audio/demo-*.wav` (original synthesised material) |

## Design system

Tokens live in `src/styles/tokens.css`; layout/components in `src/styles/globals.css`.

| Role | Value |
| --- | --- |
| Base | `#080807` · `#0D0C0B` · `#12100E` |
| Warm neutral / ink | `#F4EBDD` (muted: `rgba(244,235,221,.65)`) |
| Accent (primary) | `#F05A45` — overridden per station, e.g. Travel `#E2543A`, Folk `#C4633F`, Ambient `#E7C88B`, Festivals `#E8663A` |
| Secondary warm | `#D89A54` |
| Border / glass edge | `rgba(244,235,221,.12)` · `rgba(255,255,255,.08)` |

Type is self-hosted (`@fontsource`, latin subset only — no third-party requests):
Cormorant Garamond (brand/hero display), Inter (UI/body), IBM Plex Mono (metadata).
Hero title `clamp(48px → 120px)`, second line `44 → 110px`, eyebrow 13px at `.36em` tracking.

Motion: UI 180–300 ms · hero crossfade 780 ms · title rise+fade 520 ms; everything collapses
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
  app/App.tsx             single-screen shell: hero + player + overlays
  components/             TopNav (utility bar + Donate), CinematicHero, StationGallery,
                          FloatingPlayer, EngineDock (official provider iframe host),
                          SearchOverlay, StationInfoModal, HelpOverlay, Toast, Icons
  data/categories.ts      8 station selectors: MIX · TRAVEL · BEYOND · FOLK · AMBIENT ·
                          FESTIVALS · WORK · SHOP — each with `flagship` + `accent`
  data/stations.ts        station inventory (replace with the full source inventory)
  data/donate.ts          the configurable DONATE destination (placeholder in V1)
  hooks/                  useRadioPlayer (one API over both engines), useAudioPlayer,
                          useKeyboardShortcuts
  lib/                    catalog, hero (title/eyebrow/accent), sourcePolicy, urlSafety, share
  services/               playerManager (engine orchestration + React subscription),
                          youtubePlayer / spotifyPlayer (official embed APIs),
                          engine (shared contract), scriptLoader (one tag per API)
  styles/                 tokens.css (palette/type) + globals.css (layout & components)
  types/station.ts        the data model
```

## Content: importing the full inventory

`src/data/stations.ts` (and the `flagship` pointer in `data/categories.ts`) is all that needs
to change. Schema:

```ts
{
  id: 'truck-wala-radio',     // unique, lowercase kebab-case — required even when names repeat
  name: 'Truck Wala Radio',
  category: 'transit',        // home category; only the MIX flagship may use 'mix'
  secondaryCategories?: ['ambient'],
  flagship: true,             // exactly one per category — the hero identity for its chip
  titleLines: ['Truck Wala', 'Radio'],   // line 1 ivory, line 2 in the accent colour
  accent: '#e2543a',          // hero/CTA/active-chip tint for this station
  description: '…',
  artwork: '/art/highway.svg', // local /art/*.svg — validated to exist on disk
  url: 'https://…',           // station's own page (validated: http/https only)
  audioUrl: '/audio/…',       // required when action === 'play'
  provider?: 'youtube' | 'spotify',   // official embed playback (see below)
  playlistUrl?: 'https://www.youtube.com/playlist?list=…',  // must match `provider`
  action: 'play' | 'check',
  sourceType: 'direct-audio' | 'external-site' | 'embed',
  status?: 'ready' | 'offline' | 'unknown',
  externalLinks?: [{ label: 'Spotify', url: 'https://…' }],  // rendered only when configured
  nowPlaying?: { title, subtitle },   // real track metadata — shown in the player when known
  tags?, language?, region?, era?,
  featured?: true,            // part of the MIX rotation
  demo?: true,                // ships with locally generated sample audio
  sortOrder?: number,         // derived from array order unless set
}
```

Ratings, listener counts, heat and progress fields are intentionally absent from the model —
the UI must never display invented data. The live badge reads `ON AIR / TUNING / PAUSED /
READY / OFFLINE`, never a number.

Current state: **37 seed stations** (8 flagships), 13 playable with locally generated sample
audio whose `nowPlaying` metadata names those local files (`Demo Tape A/B/C`) rather than any
licensed song. Source pages are `https://example.org/…` placeholders — the validator warns
(never fails) on them so a real inventory paste goes straight through CI.

**Licensing rule enforced by design:** the app only plays `audioUrl` values that the project is
authorised to stream, drives provider stations only through their official embeds, opens
external stations in a new tab, and shows *Check* rather than faking playback for unavailable
sources. No scraping, proxying or re-hosting.

## Music sources: YouTube & Spotify

A station can play through the provider's **own embed** — configured entirely in
`src/data/stations.ts`, no component edits:

```ts
{
  id: 'musafir',
  provider: 'youtube',                 // or 'spotify'
  playlistUrl: 'https://www.youtube.com/playlist?list=…',   // the playlist page
  sourceType: 'embed',
}
```

- **YouTube** uses the official
  [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
  (`cuePlaylist` + `playVideo`); the playlist auto-advances inside the embed.
  **Spotify** uses the official
  [iFrame API](https://developer.spotify.com/documentation/embeds)
  (`createController` / `loadEntity`). Playback logic never leaves the providers.
- The iframe is **visible and labelled** in an engine dock above the pill — the UI never
  disguises a hidden provider player as its own. Selecting another station swaps the
  playlist inside the same iframe; leaving provider playback destroys it.
- The pill mirrors only real provider state: real track title + duration from YouTube,
  real progress from Spotify (`playback_update`). Spotify exposes no title/volume API,
  so the pill hides the volume control on those stations instead of pretending.
- Placeholder IDs (`YOUR_PLAYLIST_ID`) are treated as *not configured* at runtime and
  warned about by CI; unconfigured stations keep their current source-page behaviour.
- The provider scripts load **lazily**: no request to youtube.com / spotify.com happens
  until such a station is actually selected, and the CSP allows exactly those two hosts.

## Security

- Baseline CSP in `index.html` (meta) and `public/_headers` (HTTP): `default-src 'self'`,
  `media-src 'self' https:` (same-origin sample audio today, authorised HTTPS streams later),
  `frame-src` allowlist of exactly the two playback providers (`youtube.com`,
  `youtube-nocookie.com`, `open.spotify.com`), matching `script-src` additions for their
  official API scripts, `object-src 'none'`, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, Permissions-Policy with camera/mic/
  location/payment disabled. HSTS is commented out until the domain is confirmed HTTPS-only.
- Every URL passes `src/lib/urlSafety.ts` before render or navigation
  (`javascript:`, `data:`, `blob:`, embedded credentials → rejected).
- `src/lib/sourcePolicy.ts` is the single decision point for play / open / check / blocked.
- External links use `target=_blank rel=noopener noreferrer`.
- Station metadata is rendered as text only — no `dangerouslySetInnerHTML` anywhere.
- **The app stores nothing**: no `localStorage`, no cookies, no accounts, no secrets, no
  `VITE_*` keys, no analytics, no network calls beyond the audio you press play on.

## Accessibility & motion

- Every control keyboard-reachable with visible focus; `Space/K` play-pause, `/` or
  `⌘/Ctrl+K` search, `←/→` seek (or previous/next station when nothing is seekable),
  `↑/↓` volume, `M` mute, `S` share, `R` surprise, `?` help, `Esc` close. Every shortcut also
  has a visible control. Category switches never interrupt playback.
- `aria-live` announcements on station change, `aria-pressed` on selectors, `aria-label` on
  icon-only buttons, 44px+ touch targets, text + colour for every state, alt text on artwork.
- Progress bars render only when a real duration exists — never simulated.
- No autoplay without a user gesture; `prefers-reduced-motion` collapses all animation.

## Deploy

Static output in `dist/`. Any CDN works:

- **Cloudflare Pages / Netlify**: publish `dist/`, `_headers` is picked up automatically.
- **Vercel**: copy the `/*` block from `public/_headers` into `vercel.json` → `headers`.

Deep links are shareable and resolve to the same static app:
`/?station=truck-wala-radio&category=transit`.
