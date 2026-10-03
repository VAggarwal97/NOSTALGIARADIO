# ISSUES — complete website + admin dashboard

Audit date: 2026-10-03 · All items below are verified against the code and the
live database (file:line evidence given). CI is green (234 tests, typecheck,
54 smoke checks, production build) and the mobile/desktop audit is clean at
every viewport from 320 px to 1024 px — these are product issues, not broken
builds.

---

## Critical

### 1. Admin catalogue & settings edits never reach the website

**Symptom:** saving in `/admin` succeeds (row confirmed in Supabase), but the
public site shows no change.

**Root cause:** the site is a static build. The admin writes to the database;
the site never reads those tables.

| Admin edits | Write path | What the site actually renders | Live? |
|---|---|---|---|
| Categories (chips, hero identity) | `categories` — `src/admin/pages/CataloguePage.tsx:386–387` | **static** `src/data/categories.ts` (`App.tsx:4`, `StationGallery`, `SearchOverlay`, `lib/hero.ts`, `StationInfoModal`) | ❌ never |
| Stations (title, art, copy, order, active) | `stations` — same lines + `.update({active})` `:642` | **static** `src/data/stations.ts` (`App.tsx:5`, `StationGallery`, `lib/catalog.ts`) | ❌ never |
| Songs | `songs` — same lines | not rendered in the UI at all | ❌ in UI |
| Settings (key/value) | `site_settings` — `SettingsPage.tsx:113/132/161` | **zero reads** anywhere outside the admin itself (grep-verified) | ❌ never |
| Suggestions / votes / likes | `suggestions`, `votes`, `song_likes` | `wall_board()` + realtime + poll | ✅ live |
| On-air channel | `broadcasts` via migration-9 functions | `broadcast_state()` + realtime + 15 s poll | ✅ live |

Contributing facts:

- Same env pair on both sides (`src/admin/supabaseClient.ts:25–26`), so writes
  land in the right project — nothing fails, the site just doesn't look there.
- The seed pipeline only flows **repo → database** (`npm run seed:sql`);
  nothing ever pulls DB rows back into the build, so even a redeploy doesn't
  help.
- The channel's next-track picker *does* read the DB
  (`broadcast_next_track`, migration 9 lines 155–173: `active = true`,
  `action = 'play'`, category match). So an admin toggle **does** change what
  airs while the hero/gallery still shows the frozen static identity — the
  on-air title and the visible page disagree, which looks exactly like "the
  update didn't work."

**Permissions are already in place for the fix** — anon may select the visible
rows (`20260930000002_rls_policies.sql:29–41,118` and
`20260930000004_admin_panel.sql:178,192`).

**Fix direction (recommended Option A):**

- **A — runtime hydration:** fetch `categories` + `stations` + `site_settings`
  once at startup, merge over the static files as fallback, refresh via
  realtime/poll. Contained refactor: one hydrated catalogue module + context;
  the components already consume everything through a few imports. No deploy
  needed after admin edits. DB side needs no change.
- **B — publish pipeline:** an admin "Publish" that regenerates `src/data/*`
  and triggers a Vercel redeploy. Keeps the static architecture but needs a
  deploy token in the browser — conflicts with the no-secrets rule.

---

## High

### 2. The Settings page is inert

`SettingsPage` has full CRUD over `site_settings`, but **nothing on the public
site reads that table** — every key the admin saves has no effect anywhere.
Fixable on its own (read the keys at runtime) or as part of Issue 1's
hydration. Until then the page presents working controls that do nothing for
visitors.

### 3. The admin gives no feedback that catalogue edits won't appear

After a successful save the panel shows the saved row, with no hint that the
public site needs a hydration/publish step (`CataloguePage.tsx:386–402`).
Whatever fix is chosen for Issue 1, the panel should say plainly what happens
next ("applies live" vs "publish required").

---

## Medium

### 4. Station deletion has a silent blast radius

`foundation_schema.sql`:

- `songs.station_id … on delete cascade` (**line 107**) — deleting a station
  silently deletes **all of its song rows**;
- `station_events.station_id … on delete cascade` (line 218) — its event
  history vanishes;
- `votes.station_id … on delete cascade` (line 191) — votes *for the station*
  vanish (suggestion votes are unaffected — they carry `station_id null`);
- `suggestions.station_id … on delete set null` (line 151) — requests survive
  but lose their station stamp.

The delete control (`CataloguePage.tsx:402`) confirms only "delete this row",
not what it takes with it. Fix: a confirmation step that lists the cascade
counts (query them before deleting).

### 5. Category deletion quietly un-airs its stations

`stations.category_id references categories on delete set null`
(`foundation_schema.sql:52`), and the channel rotation matches
`s.category_id = (…slug = p_category)` (migration 9 lines 158, 169). After a
category delete its stations get `category_id = null` → they can **never be
picked again**, while the static site still shows them as normal. The
`broadcasts` row also cascades (migration 9 line 28), resetting that channel's
clock. Fix: block category delete while stations reference it, or reassign
explicitly in the admin flow.

### 6. Hero backdrops hotlink `i.pinimg.com`

Seven artwork URLs on the flagship station point at Pinterest's CDN — no
availability or ToS control, affected LCP/CLS, and they break silently if the
host rate-limits. Fix: download into `public/img/` (or the site's own CDN) and
repoint `src/data/stations.ts`. **Decision needed from you** (flagged twice,
never answered).

### 7. Donate button goes nowhere

`DONATE_LINK.href = '#'` — the navbar donate link is a placeholder; it's the
one warning `npm run validate:content` still prints on every CI run. Fix:
supply the real donation URL (or hide the entry until there is one).
**Decision needed from you.**

### 8. One-song stations loop every 12 seconds (known limitation)

The demo stations each have a single 12 s wav, so the channel re-picks the
same track and restarts its clock constantly; the client seek-to-elapsed masks
the jump, but the progress bar restarts visibly. Resolution: add real songs to
the catalogue (admin → Catalogue, which will also exercise Issue 1's fix).
No code defect.

### 9. Listener count is local-tally only

`usePresence` counts this device's own session; there is no cross-visitor
aggregation yet (ROADMAP §3 ◐ — "Supabase presence next"). The number shown
is honest but tiny. Fix direction: Supabase presence channel per category.

---

## Low / accepted tradeoffs (flagged once, consciously kept)

### 10. `/admin` has no login by design

Opened to anon on the publishable key (migration 8). Anyone with the URL can
moderate. Accepted tradeoff for this project; revisit before any real
moderation load. All admin writes are validated and logged
(`admin_activity_logs`, `ActivityPage.tsx:25`).

### 11. Songs have no public browsing surface

The `songs` table only feeds the channel pick; there is no song catalogue page
in the UI (search covers stations/categories only). By design so far —
ROADMAP §4 lists the catalogue-dependent pages as future work.

### 12. No component-level tests

Coverage is logic-first (234 unit tests across 14 files) plus an SSR smoke
suite (54 checks); React components are not unit-tested. Acceptable while the
components stay thin — worth revisiting if the Issue 1 refactor introduces
stateful catalogue contexts.

### 13. Vercel non-blocking warnings

`donate.ts` `#` (same as Issue 7) and the Pinterest hotlinks (Issue 6) are the
only build warnings. Both disappear with their fixes.

---

## Before fixing: deployment & cleanup checklist

1. **Redeploy is mandatory** — Phases 1–3 (broadcast player, LIVE strip,
   panel removals) are in the working tree but **uncommitted**, and the
   production site runs the old bundle until you commit + push + Vercel
   redeploys. Nothing has been committed or pushed by the assistant.
2. **Two-browser wall acceptance** must pass on the deployed build before the
   wall is considered done (A submits → B sees → votes persist → `/admin`
   Reject removes).
3. **Revoke the Supabase Management token** (`sbp_…` used for migrations 1–9)
   and delete `C:\Users\Asus\AppData\Local\Temp\opencode\apply-sql.mjs`,
   which contains it. Migrations are all applied; nothing else needs it.
4. **Data state note:** the `suggestions` table is currently empty on the live
   project (verified 2026-10-03), so the votes-ordered queue and the on-air
   community pick have nothing to show until requests are submitted again —
   useful for testing Issue 1 end-to-end after the fix.
