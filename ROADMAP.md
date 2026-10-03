# Nostalgia Radio — Feature Roadmap

Single source of truth for every feature from the two feature blueprints.
Legend: ✅ built & verified (CI green) · ◐ partial · ⬜ not built yet

**Build order (batches):** A Activation → B Player persistence → C Community signals →
D Live layer → E Signature radio UI → F Discovery → G Donation → H Platform/Scale.

---

## 1. Core radio

| Feature | Status | Notes |
|---|---|---|
| Global player: play/pause/next/prev/volume/mute/seek | ✅ | persists across views |
| Honest player states (no fake READY/PLAYING) | ◐ | core states; full 9-state matrix pending |
| Multi-engine: HTML5 audio | ✅ | demo + station sources |
| Multi-engine: YouTube/Spotify playback embeds | ⬜ | links today = oEmbed metadata only |
| Stations as entities (37 seeded) | ✅ | name/slug/artwork/category |
| Rich station info (region/language/era/plays) | ⬜ | needs catalogue round (G) |
| Categories (8), same-page gallery | ✅ | |
| Station switching (player/artwork/queue/metadata) | ✅ | listener-per-station count ⬜ |
| Live now indicator + current song | ◐ | request pill ✅; real song metadata ⬜ (G) |
| Up Next queue UI | ⬜ | unlocks with songs catalogue (G) |
| Recently Played (timestamped history) | ⬜ | unlocks with catalogue (G) |
| Surprise Me | ✅ | |
| Player persistence (station/queue/volume/position → Resume) | ⬜ | **Batch B** |
| Sleep timer (15/30/45/60/end-of-song) | ⬜ | Batch E |
| Night mode | ⬜ | Batch E |
| Offline/error experience (radio ≠ community degradation) | ✅ | honest fallbacks |

## 2. Community radio

| Feature | Status | Notes |
|---|---|---|
| Suggest a song (URL → oEmbed → DB-confirm → success) | ✅ | fixed today; awaiting redeploy |
| Duplicate detection → vote-for-it, no `#1/#2` copies | ✅ | by provider id |
| Votes persisted server-side, 1/visitor/token, server rate limits | ✅ | client + DB definer triggers |
| Most Wanted / Rising / Recently Added / Played tabs | ✅ | Played ◐ (admin mark-played) |
| Community queue lifecycle (submitted→…→played) | ◐ | approve/played via admin; live QUEUED state ⬜ |
| **Community Pick** (on-air request + "you helped choose") | ✅ | pill + dock + expanded player + wall card, `communityPick` helper, votes never faked |
| Likes (separate from votes) | ✅ | Batch C — migration 7 (`song_likes` + `song_like_counts`, insert-only, definer rate limit, visible-requests policy incl. played), `♡ LIKE` → `♥ LIKED` on leader + cards, device-memory `liked`, full CI green + anon E2E probe verified |
| Song reactions (Love it/Banger/Nostalgia/…) | ⬜ | Batch C |
| Dedications (moderated) | ⬜ | Batch C |
| Shoutouts (moderated) | ⬜ | Batch C |
| Momentum bars / +votes-today Rising detail | ⬜ | Batch C |
| Queue status badges (PENDING→APPROVED→QUEUED→PLAYING→PLAYED) | ◐ | statuses exist; QUEUED/PLAYING events ⬜ |
| Report content / metadata corrections | ⬜ | Batch H |
| Moderation (approve/reject/delete + audit) | ✅ | route mounted — open panel (no login) + trigger audit; per-row clear votes/likes |

## 3. Live layer

| Feature | Status | Notes |
|---|---|---|
| Realtime wall updates (submit/vote → all viewers) | ✅ | broadcast + ≤20s poll |
| Synchronized live broadcast (shared clock → all listeners) | ✅ | server `started_at` + `broadcast_state`; join-seek; CAS auto-advance |
| Votes-ordered queue on air (suggestions first, then rotation) | ✅ | migration 9 picks; client never fakes airtime |
| Realtime player events (now playing → all) | ✅ | `TRACK_CHANGED` on `public.broadcasts` — state only; audio from source |
| Live listener count (aggregated presence) | ◐ | honest local-tally only; Supabase presence next |
| Per-station listener counts | ⬜ | Batch D |
| Listeners around the world (coarse geo) | ⬜ | Batch D |
| "Listening with you" copy | ⬜ | Batch D |
| Trending/community momentum feed | ⬜ | Batch D |
| Weekly recap / public statistics page | ⬜ | Batch D (real queries only) |
| High-frequency position telemetry | ❌ | rejected by design |

## 4. Discovery

| Feature | Status | Notes |
|---|---|---|
| Global search overlay | ◐ | songs/stations; requests/eras ⬜ |
| Era explorer (1960s–2000s) | ⬜ | needs catalogue (G) |
| Mood explorer | ⬜ | needs catalogue (G) |
| Artist pages | ⬜ | needs catalogue (G) |
| Nostalgia Archive | ◐ | section copy; real content ⬜ |
| "About this song" drawer | ⬜ | needs catalogue (G) |
| Personal favorites (local) | ⬜ | Batch E |
| Listening history (local) | ⬜ | Batch E |
| Personal mix (local, no profile) | ⬜ | Batch E |
| Achievements (local) | ⬜ | Batch E |

## 5. Signature radio UI

| Feature | Status | Notes |
|---|---|---|
| Radio tuner (drag FM dial across stations) | ⬜ | Batch E |
| Station atmospheres | ◐ | scene artwork exists; per-theme effects ⬜ |
| Category sound effects | ⬜ | Batch E (gesture-gated, no autoplay) |
| Deep-link share song / share station | ◐ | request share ✅; station/song deep links ⬜ |
| Native mobile share | ✅ | on requests |
| Keyboard controls | ✅ | |
| Accessibility (focus/labels/contrast/reduced-motion) | ✅ | |
| PWA / installable | ⬜ | Batch H |

## 6. Donation / support

| Feature | Status | Notes |
|---|---|---|
| Donate link in navbar | ◐ | placeholder `#` (CI warns) |
| Donation page (hero/tiers/custom/UPI) | ⬜ | Batch G — needs your payment details |
| Payment provider integration + server-side verify | ⬜ | Batch G |
| Donation wall / goal / transparency / receipts | ⬜ | Batch G (real numbers only) |
| Player stays alive on donation page | ⬜ | Batch G |

## 7. Platform / scale

| Feature | Status | Notes |
|---|---|---|
| RLS, no service key in frontend, write-only token, URL validation | ✅ | |
| Rate limits (client + DB), duplicate guard, server validation | ✅ | CAPTCHA ⬜ until needed |
| Admin audit log | ✅ | DB triggers |
| Admin panel (dashboard/suggestions/catalogue/settings/activity) | ✅ | no login (migration 8) — own lazy chunk, SSR proves it stays out of the bundle |
| Access model: open panel, no auth | ✅ | owner directive: no login/OTP/roles of any kind — migration 8 retires `admin_users`/`is_admin()`, panel runs on the publishable key (supabase §9) |
| Admin analytics (daily users/plays/top songs) | ⬜ | Batch H |
| Fault isolation (any service down → radio still plays) | ✅ | |
| Performance (lazy/pagination/CDN) | ◐ | chunk-split ✅; pagination ⬜ |
| AI assistance (curation/moderation help) | ⬜ | later |
| Accounts / leaderboards / profiles | ❌ | rejected by design (anonymous-first) |
| Listening rooms | ⬜ | later |

---

## Batch log

- **Batch A — Activation**: migration 6 applied + proven (submit/vote/count end-to-end via live probes), manual rows purged, admin route withdrawn → **re-mounted** → **rebuilt with no login** (owner directive: migration 8 open panel, supabase §9). ⏳ *Awaiting: commit → Vercel redeploy → two-browser acceptance test.*
- **Batch B — Player persistence**: storage key, boot restore with Resume (no autoplay), honest idle/ready states.
- **Batch C — Community signals**: Community Pick ✅ (pill/dock/expanded/wall + device-vote credit) → likes ✅ → reactions → dedications → shoutouts → momentum.
- **Batch D — Live layer**: Supabase presence → per-station counts → listening-with-you → recap/stats → realtime now-playing.
- **Batch E — Signature UI**: tuner → sleep timer → night mode → favorites/history/mix → atmospheres/sound FX → deep links.
- **Batch F — Discovery**: search expansion → era/mood/artist/about-this-song/archive (needs songs catalogue).
- **Batch G — Donation**: page + tiers + UPI/provider + server-verified success (needs payment details).
- **Batch H — Platform**: ~~catalogue/editors~~ → ~~roles+OTP~~ *(superseded: open panel, no auth)* → analytics → reports/moderation → PWA. *Catalogue + Settings screens shipped in the no-login rebuild (supabase §9); site-side catalogue fetch still deferred (§8).*
