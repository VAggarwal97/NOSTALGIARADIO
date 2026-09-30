# Nostalgia Radio

A **cinematic radio experience** with an old Indian radio/cassette soul — the listening
screen, plus the community wall at `/suggest-music`.
Vite + React + TypeScript · two views · no login · no database · static CDN deploy.

> **Design direction:** *"You opened a radio station, not a website containing radio
> stations."* The artwork is the page, the station identity is the hero, the player is the
> primary interaction, and everything else stays out of the way.

## The screen (two views, no templates)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NOSTALGIA RADIO  Suggest music  Spotify ↗  YouTube Music ↗  Donate  ?  ⌕ │
│                                                                          │
│  ● READY   1 LISTENING            EXPLORE THE RADIO        37 STATIONS   │
│  TRAVEL · ROAD · PEOPLE · MEMORIES  ┌──────┐ ┌──────┐                     │
│  Truck                              │ MIX  │ │TRAVEL│                    │
│  Wala                               ├──────┤ ├──────┤                    │
│  Radio                              │BEYOND│ │ FOLK │                    │
│  Highway bangers, desi beats and    ├──────┤ ├──────┤                    │
│  trucker tales…  ← artwork behind   │AMBIEN│ │FESTIV│                    │
│  ⌖ Highway · Hindi · 1990s–2000s    ├──────┤ ├──────┤                    │
│  [ ▶ PLAY ]  [ SURPRISE ME ]  ⋯     │ WORK │ │ SHOP │  ← drifts slowly   │
│                                     └──────┘ └──────┘    (pauses for you)│
│        SPACE Play/Pause   ← → Seek   M Mute   S Share   ? Help           │
│                                                                          │
│  ★ 4.4          ╭────────────── glass pill player ───────────────╮       │
│  128 ratings    │ (ART)  Demo Tape A · ON AIR · Truck Wala Radio │       │
│  + SUGGEST      │        ◀   ❚❚   ▶    🔊   ☰   ⌄               │       │
│  MUSIC          │        ──────────●──────────        00:12/03:00 │       │
│                 ╰────────────────────────────────────────────────╯       │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Header is a text masthead, not an app toolbar**: brand on the left; **Suggest music** ·
  Spotify ↗ · YouTube Music ↗ · **Donate** · help · search on the right — plain type on a
  hairline hover underline, no pills, boxes, borders or circular icons, and no category links
  (they live in the hero). **Suggest music** is a real, shareable link to `/suggest-music`
  (modified clicks keep their native new-tab behaviour) and reads **Radio** while you are on
  that view.
- **The category gallery lives inside the hero.** The right side of the hero is a bounded
  archive viewport of miniature posters — two columns, one card per listening world (artwork,
  name, one-line tagline, `region · language · era`, status, a bare `→` that steps right on
  hover). Pressing TRAVEL swaps the hero to that category's flagship station — artwork,
  two-line title, copy, metadata, accent and track all crossfade. Same screen, same layout,
  nothing navigates, nothing reloads. Its header is plain mono type (`EXPLORE THE RADIO` /
  `37 STATIONS` plus `VIEW ALL 37 →`) — no badge, pill or border. The grid **drifts slowly on
  its own** (~22 px/s, a seamless loop whose second copy is `aria-hidden` and out of the tab
  order); wheel, touch, keys, clicks and hover pause it, and it resumes a few idle seconds
  later — scrolling is native, never hijacked. A 3px hairline scrollbar reveals while you
  scroll and fades ~800ms after you stop, gradient masks fade the top and bottom rows, and the
  active card brightens its artwork with a coral glow and a thin coral underline — no borders.
  On mobile it becomes a horizontal snap rail under the station copy — never a sidebar.
- **Hero** ≈ 100vh: cinematic artwork with a slow 34s breathing drift — or, for stations that
  declare `backdrops`, one real stage photo drawn at random **per page load** (reload the page
  and the stage changes; nothing is stored) — plus a coral accent
  glow, dark multi-layer scrim, grain, a non-numeric live badge (**READY / LOADING / ON AIR /
  PAUSED / OFFLINE / ERROR** with green/amber/muted/red states) plus the live session count
  once presence answers, editorial serif title (line 2 in the station accent), short
  description, `⌖ region · language · era`, one dominant CTA, **Surprise me**, subtle
  keyboard hints.
- **Floating glass player**: pill (720px max, backdrop blur, soft shadow) with circular
  artwork, track/station, `● ON AIR · station`, transport, volume, a real queue of the
  current station set, and a progress line that renders **only** when the audio reports a
  real duration. It can minimise into a small `◉ Now Playing` chip. Mobile: compact rounded
  bar → expands in place. The player owns **playback only**.
- **Participate controls sit beside the player** (above it on narrow screens, never inside
  it): `★ 4.4 / 128 ratings` with a small rating popover, and **+ Suggest music**, which
  navigates to the community wall (`/suggest-music`) — the overlay it once opened is gone.
  Rating data and aggregates load asynchronously from the rating API and start honestly empty
  — `★ Rate · Be the first` until somebody rates.
- **Donate is a reserved slot, not a flow (V1)**: a navbar button pointing at a configurable
  destination (`src/data/donate.ts`, currently the `#` placeholder). No donation page, form or
  payment code — swap the `href` when the real link exists.
- **Overlays only**: search (command palette), station details, keyboard help, toasts.

Deliberately absent from the public experience: rails/grids of cards, category sections,
footer blocks, sidebars, category pages, logins, avatars, wishlists, dashboards,
notifications, admin/analytics widgets, filter panels, dense tables, fabricated listener
counts, progress or vote totals, decorative controls, autoplay. The one private exception is
`/admin` — an unlinked control room for the site owner (email-gated, database-authorized);
visitors never see or reach it from the UI (see “Admin control room” below).

## The community wall: `/suggest-music`

`Suggest music` in the navbar and `+ Suggest music` beside the player both open the second
view — same shell, same typography, same playing audio (history-API navigation, no reload,
the current song never stops):

- **Hero**: eyebrow `COMMUNITY RADIO`, the two-line `SUGGEST YOUR MUSIC` title, and a console
  that accepts **one URL only** — a YouTube video or a Spotify track. The link is resolved
  through the provider's own oEmbed endpoint *before* you submit, so the preview (title,
  artist, artwork) is real; a refusal says so instead of guessing.
- **Duplicate → `VIEW REQUEST`**: an existing request is detected by provider ID (share
  params normalised away) and the console jumps to it instead of creating a second one.
- **How it works**: 01 share a song → 02 collect votes → 03 it moves into the radio queue.
- **The wall**: `WHAT SHOULD PLAY NEXT?` with text tabs — `MOST WANTED` (votes, ties resolve
  to the earlier submission), `RISING` (recent voting activity), `RECENTLY ADDED`, `PLAYED`
  — a featured `CURRENTLY LEADING` request, then artwork-dominant cards with `▲ VOTE` →
  `▲ VOTED`, `SHARE ↗` (native share sheet, clipboard fallback) and inline search. Loading,
  empty and error states are explicit and **there is no seed data**: an empty board says it is
  waiting for the first request, and SSR renders no fake vote digits.
- **Deep links**: `/suggest-music?request=<id>` opens straight to that request (tab switch +
  highlight) — exactly what `SHARE ↗` copies.
- **Routing is a history API, not a router dependency**: real `<a href>` links (shareable,
  middle-clickable, back button behaves normally) with intercepted plain clicks; on static
  hosts the build copies `index.html` to `dist/suggest-music/index.html`, so a cold load of
  the URL resolves too.

Votes, statuses, rankings and track metadata all come from `src/lib/request-api.ts` and the
providers' oEmbed endpoints — the client never computes, trusts or fabricates them.

**How a request actually airs** (`src/lib/queue.ts`, driven from `App`): at every playback
boundary — a sample track ends, a request finishes, or you press `►►` on the pill — the
`MOST WANTED` order is fetched fresh and the **highest-voted open request** goes on air
through the provider's official embed. The song that is playing is never interrupted
mid-track; the queue only ever takes over at a boundary. A request that plays to its end (or
is advanced past with Next) retires to `PLAYED` and never replays; one whose source fails, is
unavailable, or cannot be embedded is skipped for the session and the **next highest-voted**
takes its place — three failures in a row end the queue. Provider playlists keep managing
themselves: the queue only steps in at a real track boundary (a new video title or the end of
the list), never on a timer. While a request is on air the pill and the engine dock label it
`Community request` with the request's real title.

Two deliberate escapes from the boundary rule, both gated by `radioIsSilent` — **only ever
while the radio has never started this session**, where nothing is playing to interrupt and
the click is a live user gesture: a successful **submit** and a confirmed **vote** put the
request on air immediately (`paused` is deliberate silence and is respected). Everything else
is explicit: every open card carries a **`► Play`** button that airs that request on demand
(it becomes a live `● On air` state while it plays). Once anything has played, the boundary
rule owns every hand-off as described above.

## Supabase foundation (built, not wired)

The community layer has a production-ready backend waiting in `supabase/`: four idempotent
migrations covering the schema (`categories → stations → songs`, plus `suggestions`, `votes`,
`station_events`), row-level security with least-privilege grants, indexes, database-side
rate limits that mirror the UI's rules exactly (3 suggestions / 10 votes per visitor per
minute, one row per song id forever), and a catalogue seed generated from `src/data/*` by
`npm run seed:sql`. Design rules: no audio bytes in Postgres — pointers only; no stored vote
counts — totals come from the token-free `suggestion_vote_counts` view; no visitor token ever
leaves the database; no service-role key anywhere in the repo.

The public site still runs entirely on the local request store through the `getRequestApi()`
seam (tests, demo and CI need no network and no database), so nothing changes for visitors
until the wiring round. Moderation is already usable from the Table Editor: submissions land
as `pending` and appear on the wall once flipped to `approved`. Full how-to, status mapping,
error mapping and security checklist: [`supabase/README.md`](supabase/README.md).

## Admin control room (`/admin`, built)

A private, deliberately unlinked control room lives at `/admin` — no public button, no
password, no signup:

- **Access gate**: enter an authorized email → Supabase Auth sends a one-time code → the
  *database* decides entry (`is_admin()` over `admin_users`, enforced by RLS — a bypassed
  front end still reads and writes nothing). Unknown addresses get one identical refusal.
- **Dashboard**: live content/community counts and system status, measured by the page's own
  queries (no decorative numbers). **Suggestions**: approve / reject / mark played / delete,
  with the audit trail stamped server-side. **Activity log**: rows written by database
  triggers, so a modified client cannot hide what happened.
- Bootstrap is one SQL statement after the owner's first sign-in (documented in
  [`supabase/README.md`](supabase/README.md) §9). The panel ships in its own lazy chunk —
  the public bundle never downloads Supabase code.

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
| `npm test` | Vitest: URL safety, source policy, catalog/search, the request board (dedupe, rate limits, one vote per visitor, ranking rules), the community queue (eligibility, hand-off, retire rules), session backdrop draw, provider metadata resolution, spec invariants, Supabase seed drift + admin-panel security invariants |
| `npm run typecheck` | `tsc -b` |
| `npm run smoke` | Renders `/`, `/suggest-music` and `/admin` to HTML through Vite SSR and asserts structure, the access gate's honest states, empty states and no fabricated data |
| `npm run build` | Validate → typecheck → Vite production build into `dist/` |
| `npm run ci` | The full gate: validate → test → typecheck → smoke → build |
| `npm run preview` | Serve the production build |
| `npm run demo:audio` | Regenerate `public/audio/demo-*.wav` (original synthesised material) |
| `npm run seed:sql` | Regenerate `supabase/migrations/*_seed_catalogue.sql` from `src/data/*` (CI fails if the committed seed drifts) |

## Design system

Tokens live in `src/styles/tokens.css`; layout/components in `src/styles/globals.css`; the
community wall in `src/styles/suggest.css` (same tokens, no palette forks).

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
  app/App.tsx             one shell, two views: history-API routing + hero + player + overlays
  components/             HomeNav (borderless text masthead), CinematicHero, StationGallery
                          (drifting archive), FloatingPlayer, CommunityControls (rating +
                          suggest beside the player), EngineDock (official provider iframe
                          host), SearchOverlay, StationInfoModal, HelpOverlay, SuggestPage
                          (community wall → SuggestConsole + RequestBoard), Toast, Icons
  data/categories.ts      8 station selectors: MIX · TRAVEL · BEYOND · FOLK · AMBIENT ·
                          FESTIVALS · WORK · SHOP — each with `flagship` + `accent`
  data/stations.ts        station inventory (replace with the full source inventory)
  data/donate.ts          the configurable DONATE destination (placeholder in V1)
  hooks/                  useRadioPlayer (one API over both engines), useAudioPlayer,
                          useKeyboardShortcuts, usePresence, useStationRating
  lib/                    catalog, hero (title/eyebrow/accent), sourcePolicy, urlSafety,
                          share, routes (the two view URLs + deep links), track-meta
                          (provider oEmbed metadata), presence-api, rating-api, request-api
                          (board/vote API with a local store), queue (what airs next and
                          how it hands off), backdrop (one stage photo per page load), id
  services/               playerManager (engine orchestration + React subscription),
                          youtubePlayer / spotifyPlayer (official embed APIs),
                          engine (shared contract), scriptLoader (one tag per API)
  styles/                 tokens.css (palette/type), globals.css (layout & components),
                          suggest.css (community wall)
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
  backdrops?: ['https://…jpg', …], // hero-stage photos: one drawn at random per page load
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

Station records carry no rating, listener or heat fields — the model cannot invent data.
Runtime aggregates come from their APIs instead: ratings start at `count: 0, average: null`,
and the live badge reads `READY / LOADING / ON AIR / PAUSED / OFFLINE / ERROR` plus a real
session count only after the presence channel answers — never a hardcoded number.

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

## Living layers: presence · discovery · community

Three systems sit on top of the static screen. All three follow the same rules: they load
**after first paint**, they never block rendering or playback, and they never invent data.

- **Presence** (`src/lib/presence-api.ts`, `usePresence`) — the badge's live session count.
  V1 runs a local `BroadcastChannel` channel: every open tab of this browser heartbeats
  every 5s and leaves on unload, so the number is the real count of sessions this device
  knows about (`1 LISTENING` on a single tab, more with duplicates). A realtime backend
  (Supabase Realtime or similar) can implement the same `PresenceApi` for a global count —
  no keys live in the repo. SSR renders no count at all.
- **Discovery** — the archive drift + search + Surprise me share one rule: manual input
  always wins. The drift pauses on hover/wheel/touch/key/click for ~4s (3s after the
  pointer leaves), wraps seamlessly through a loop copy that is `aria-hidden` and outside
  the tab order, and stops entirely under `prefers-reduced-motion` or the mobile rail.
- **Community** — ratings and suggestions, both behind typed APIs with local
  implementations that a backend can replace without touching the UI:
  - `src/lib/rating-api.ts` — anonymous session rating, one row per visitor per station
    (`UNIQUE(station_id, visitor_id)` is the backend's job, the local store upserts the
    same way). Aggregates start empty: `count: 0, average: null` until a real rating lands.
  - `src/lib/request-api.ts` — the community board behind `/suggest-music`: `parseSongUrl`
    accepts **only** a YouTube video or a Spotify track (playlists, albums, channels and
    unknown hosts are refused), duplicates are caught by provider ID (share params are
    normalised away), submits and votes are rate limited, and voting is **one per visitor per
    request** — a count only moves when the API confirms it. Ranking (`MOST WANTED` votes
    with earliest-submission tie-break, `RISING` by last vote, `RECENTLY ADDED`,
    `PLAYED` history) and search live in the API, so the UI can never compute a number.
    V1's local store syncs snapshots across this browser's tabs over a `BroadcastChannel`
    (each tab's voter bookkeeping stays local); a backend implementing the same interface
    drops in later without touching the components. Track metadata (title, artist, artwork)
    is resolved by `src/lib/track-meta.ts` through each provider's own oEmbed endpoint —
    a refusal renders an honest unavailable state, never invented tags.
  - `src/lib/queue.ts` — the hand-off rules between that board and the player: which
    requests are eligible (open · playable · not on air · not failed this session), which
    origin reported a boundary, and when a request retires to `PLAYED`. The client never
    decides votes or rank — it only asks the API what is next.

All motion is CSS/`requestAnimationFrame` only — no animation library. Everything secondary
(search, rating data, presence, the request board) loads after first paint, so the first
paint is just the hero, the gallery and the player shell. `index.html` paints a branded
dark boot screen from the very first byte (removed by `main.tsx` right before React takes
over), the hero stage photo — the page's LCP — carries `fetchpriority="high"` and a
`preconnect` to its image host opens during HTML parse, and the demo audio is
`preload="none"`: nothing extra competes with the first paint.

## Security

- Baseline CSP in `index.html` (meta) and `public/_headers` (HTTP): `default-src 'self'`,
  `media-src 'self' https:` (same-origin sample audio today, authorised HTTPS streams later),
  `img-src 'self' data: https:` (real artwork and hero-stage photos load as plain images),
  `frame-src` allowlist of exactly the two playback providers (`youtube.com`,
  `youtube-nocookie.com`, `open.spotify.com`), matching `script-src` additions for their
  official API scripts, `connect-src` for the app, the playback providers, their own oEmbed
  metadata endpoints (track metadata — no search APIs, no trackers) and the Supabase project
  origin reserved for the not-yet-wired community backend, `object-src 'none'`,
  `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, Permissions-Policy with camera/mic/
  location/payment disabled. HSTS is commented out until the domain is confirmed HTTPS-only.
- Every URL passes `src/lib/urlSafety.ts` before render or navigation
  (`javascript:`, `data:`, `blob:`, embedded credentials → rejected).
- `src/lib/sourcePolicy.ts` is the single decision point for play / open / check / blocked.
- External links use `target=_blank rel=noopener noreferrer`.
- Station metadata is rendered as text only — no `dangerouslySetInnerHTML` anywhere.
- **The app stores nothing**: no `localStorage`, no cookies, no accounts, no secrets, no
  `VITE_*` keys read anywhere, no analytics. Network access is limited to the audio you press
  play on, the official API scripts of the provider station you selected, and the oEmbed
  metadata lookup you trigger by pasting a track link; presence and the request board sync
  over a local `BroadcastChannel` — same browser only, nothing else crosses the network.
- The Supabase foundation in `supabase/` inherits that posture: RLS means the publishable key
  hands out nothing but what the policies allow, `.env.local` (git-ignored) is the only place
  credentials may live, the service-role key is banned from the client by construction, and
  public writes are validated in the database — a hand-crafted request obeys the same rules as
  the UI. See `supabase/README.md` §7 for the checklist.

## Accessibility & motion

- Every control keyboard-reachable with visible focus; `Space/K` play-pause, `/` or
  `⌘/Ctrl+K` search, `←/→` seek (or previous/next station when nothing is seekable),
  `↑/↓` volume, `M` mute, `S` share, `R` surprise, `?` help, `Esc` close. Every shortcut also
  has a visible control. Category switches never interrupt playback.
- `aria-live` announcements on station change, `aria-pressed` on selectors, `aria-label` on
  icon-only buttons, 44px+ touch targets, text + colour for every state, alt text on artwork.
- The community wall is keyboard-native: its views are a real `role="tablist"` with
  `aria-selected`, vote buttons carry `aria-pressed`, vote counts announce politely through
  `aria-live`, the URL field is a labelled single-input form with a status region, and a
  `?request=` deep link lands focus on the highlighted card.
- Progress bars render only when a real duration exists — never simulated.
- No autoplay without a user gesture; `prefers-reduced-motion` collapses all animation and
  stops the archive drift, which otherwise pauses for hover, wheel, touch, keys and clicks
  and resumes only after a few idle seconds.

## Deploy

Static output in `dist/`. Any CDN works:

- **Cloudflare Pages / Netlify**: publish `dist/`, `_headers` is picked up automatically.
- **Vercel**: copy the `/*` block from `public/_headers` into `vercel.json` → `headers`.

Deep links are shareable and resolve to the same static app:
`/?station=truck-wala-radio&category=transit`, `/suggest-music`, and
`/suggest-music?request=<id>` — the build writes `dist/suggest-music/index.html`, so plain
file servers and GitHub Pages resolve the community route on a cold load too.
