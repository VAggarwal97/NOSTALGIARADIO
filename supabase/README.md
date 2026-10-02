# Supabase — community backend foundation

Nostalgia Radio's public experience stays a login-free radio. This directory is
the **backend** behind it: catalogue + community tables, row-level security,
indexes, server-side rate limits, the generated seed, the private `/admin`
control room and — since the wiring round (§10) — the public wall itself. The
site talks to Supabase only when `VITE_SUPABASE_URL` +
`VITE_SUPABASE_PUBLISHABLE_KEY` are present; without them it keeps running on
the local request store, fully offline.

```text
Browser (publishable key only)          Audio bytes
        │                                    │
        ▼                                    ▼
   Supabase API ── RLS ──► PostgreSQL    Audio/CDN host
   (metadata, votes,                (never in the database)
    suggestions)
```

> **Rule:** the database stores *pointers and facts*. Never MP3s, never a
> vote count, never a secret.

---

## 1. Applying the migrations

Run the eight files in `supabase/migrations/` **in this order**. Either way:

**SQL Editor (simplest):** Dashboard → SQL Editor → New query → paste each file
whole → Run. Repeat for the next file.

**CLI:** `supabase link --project-ref kgeeikjpjydotawjilvs` then
`supabase db push` (requires the Supabase CLI and your database password).

| # | File | What it does |
|---|------|--------------|
| 1 | `20260930000001_foundation_schema.sql` | Tables, CHECK constraints, indexes, rate-limit triggers, `suggestion_vote_counts` view |
| 2 | `20260930000002_rls_policies.sql` | Row Level Security, least-privilege grants |
| 3 | `20260930000003_seed_catalogue.sql` | 8 categories + 37 stations (generated — see §5) |
| 4 | `20260930000004_admin_panel.sql` | Admin authz tables, `is_admin()`, admin policies, activity log, settings, `request_wall` view (see §9) |
| 5 | `20260930000005_public_wiring.sql` | Seamless `approved` default, widened public INSERT policy, `suggestions` in the realtime publication, `wall_board()` query function (see §10) |
| 6 | `20260930000006_definer_rate_limits.sql` | Rate-limit triggers as `security definer` — without it every public insert fails with `42501` (the counters read `visitor_token`, which anon may never select) |
| 7 | `20261002000007_song_likes.sql` | `song_likes` + `song_like_counts` (likes counted, never stored), insert-only grants for the browser, visible-requests policy, `enforce_like_rate()` as definer from day one |
| 8 | `20261002000008_open_panel.sql` | **No-login control room**: retires `admin_users`/`is_admin()`/`*_admin_all`, opens the panel's tables to anon+authenticated, grants token-free reads + panel DML, rewrites the audit trigger to log anon actions (see §9) |

All eight are **idempotent** — re-running any of them is safe.

**Verify afterwards** (SQL Editor):

```sql
select count(*) from public.categories;  -- 8
select count(*) from public.stations;    -- 37
select count(*) from public.songs;       -- 0 (by design, for later phases)
select relrowsecurity from pg_class where relname in
  ('categories','stations','songs','suggestions','votes','station_events',
   'admin_activity_logs','site_settings','song_likes');
-- 9 rows, all true (admin_users dropped by migration 8)

-- migration 5:
select column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'suggestions'
   and column_name = 'status';           -- 'approved'::text
select count(*) from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public' and tablename = 'suggestions';  -- 1
select proname from pg_proc where proname = 'wall_board';     -- 1 row
-- board spot-checks: ordering, search, and the visibility hardcode
select title, votes from wall_board('wanted', '', 5);      -- votes desc, approved only
select title, created_at from wall_board('recent', '', 5); -- created_at desc
select count(*) from wall_board('wanted', 'zzz-no-match', 60); -- 0 → search works

-- migration 6 (both counters must be definer with a pinned path):
select proname, prosecdef, proconfig from pg_proc
 where proname in ('enforce_suggestion_rate', 'enforce_vote_rate');
-- 2 rows, prosecdef = t, search_path = "{public,pg_temp}" each

-- migration 7 (likes: insert-only for the browser, tokens keep no SELECT):
select has_table_privilege('anon', 'public.song_likes', 'insert')  as can_insert,
       has_table_privilege('anon', 'public.song_likes', 'select')  as can_select;
-- t / f
select has_table_privilege('anon', 'public.song_like_counts', 'select') as view_select; -- t
select proname, prosecdef, proconfig from pg_proc where proname = 'enforce_like_rate';
-- 1 row, prosecdef = t, search_path = "{public,pg_temp}"
select count(*) from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'song_likes'; -- 0 (likes ride the poll, like votes)

-- migration 8 (open panel: authorization layer retired, tokens still private):
select to_regclass('public.admin_users') as admin_users,            -- null
       (select count(*) from pg_proc
         where proname in ('is_admin','admin_role')) as auth_fns;    -- 0
select count(*) from pg_policy where polname like '%_open_panel';    -- 9
select has_column_privilege('anon','public.votes','visitor_token','select') as token_select,        -- f
       has_column_privilege('anon','public.votes','id','select') as id_select,                      -- t
       has_table_privilege('anon','public.admin_activity_logs','insert') as log_insert;             -- t
```

---

## 2. Keys and credentials

| Key | Where it lives | May the browser see it? |
|-----|----------------|-------------------------|
| Project URL `https://kgeeikjpjydotawjilvs.supabase.co` | `.env.example`, CSP | Yes (not secret) |
| Publishable (anon) key | `.env.local` → `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes — RLS is its jail |
| Service role key | Nowhere in this repo | **Never. Ever.** |
| Database password | Supabase dashboard only | Never pasted into chats, logs or Git |

- Copy `.env.example` → `.env.local` (both `.env` and `*.local` are
  git-ignored): needed by the admin panel (§9) and the public wall (§10).
  The **deployed** site needs the same two values in Vercel — see §10.
- **Rotate the database password** (Settings → Database → Reset password) if it
  was ever shared anywhere — including truncated. The service-role key must
  never be generated into a `VITE_` variable: Vite inlines it and every
  visitor would receive full bypass of RLS.

---

## 3. Schema at a glance

```text
categories ──< stations ──< songs
                  │
suggestions ──< votes          station_events (write-only analytics)
(status lifecycle)             (one event per action, never per second)
```

- **No stored counts.** `suggestions` has no `vote_count` column — totals come
  from the public `suggestion_vote_counts` view (an aggregate that exposes
  nothing but `suggestion_id` + `votes`).
- **Visitor tokens never leave the database.** There is no public `SELECT`
  policy on `votes`, and the wall's column-level grant on `suggestions`
  excludes `visitor_token`. "Have I voted?" is remembered on the device,
  exactly like the V1 tab-local voter sets.
- **`songs` starts empty on purpose.** The table exists so the UI can grow into
  paginated libraries (first 20, then more) without a redesign. The page never
  downloads a whole library.

### Status vocabulary

The database uses the moderation lifecycle you asked for; the mapping to the
wall's terms is implemented in `src/lib/supabase-request-api.ts`:

| Database `suggestions.status` | Wall sees it as | Publicly visible |
|---|---|---|
| `pending` | *(never fetched)* | No |
| `approved` | `open` (votable, queue-eligible) | Yes |
| `played` | `played` (history, never replays) | Yes |
| `rejected` | `unavailable` (refused) | No |

Since migration 5 a public insert **lands as `approved`** (seamless — see §4),
so `pending` only exists while strict pre-moderation is on or when an admin
deliberately holds a row back.

---

## 4. Moderation workflow

**Seamless mode is on** (migration 5 — submissions behave like V1, but shared):

1. A visitor submits → the row lands as **`approved`** (the client never sends
   `status`; the column default decides) → it is on the wall and in the queue
   rankings the moment it is sent.
2. Review any time in **`/admin` → Suggestions** (Approve / Reject / Mark
   played / Delete) — or in **Table Editor → suggestions → status**. Both
   paths run through the same RLS; every move from the panel is recorded in
   the activity log as `open panel` (§9).
3. When it airs, its status moves to **`played`** + `played_at` set (the admin
   panel's “Mark played”). Played rows are history: they never re-enter the
   queue.

**Strict pre-moderation** (optional — new submissions wait for approval
before anyone can see or vote them). Two statements:

```sql
alter table public.suggestions alter column status set default 'pending';

drop policy if exists "public submits requests" on public.suggestions;
create policy "public submits pending requests"
  on public.suggestions for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and visitor_token is not null
    and length(visitor_token) <= 100
  );
```

The policy half matters: the browser never writes `status`, but a hand-crafted
request could try to — with `status = 'pending'` the only accepted value,
strict mode cannot be talked around. In strict mode the wall simply never
receives a row until an admin approves it (step 2 above).

**Back to seamless:** re-run migration 5 (idempotent) — it restores the
`approved` default and the widened policy.

---

## 5. Regenerating the catalogue seed

`src/data/categories.ts` + `src/data/stations.ts` stay the source of truth.

```powershell
npm run seed:sql
```

re-emits `20260930000003_seed_catalogue.sql` (idempotent `on conflict … do
update`, community data untouched). `tests/supabaseSeed.test.ts` fails CI when
the committed seed drifts from the code, so the rule is simple:

> **Edit the TypeScript → run `npm run seed:sql` → commit both.**

The generator validates every value against the schema's CHECK constraints
before writing, so a bad entry fails here with an exact field path instead of
erroring halfway through a paste in the SQL Editor.

---

## 6. Error mapping (implemented)

`src/lib/supabase-request-api.ts` translates database signals into the
existing failure vocabulary (`duplicate`, `already-voted`, `rate-limited`,
`not-found`, `unavailable`) — and anything unexpected becomes an honest
failure the UI shows, never a fake success:

| UI failure | Database signal |
|---|---|
| `duplicate` / `already-voted` | `23505` unique_violation (`suggestions_one_per_song`, `votes_one_per_suggestion`) |
| `rate-limited` | message starts with `rate-limited:` (triggers: 3 suggestions/60 s, 10 votes/60 s per token) |
| `not-found` | `23503` foreign_key_violation on `votes.suggestion_id` |
| `unavailable` | RLS violation `42501` (vote aimed at a pending/rejected suggestion or inactive station) |
| moderation wait | strict mode only: row stays `pending`; the wall simply doesn't receive it until approved |
| any other / network error | surfaced as an error state — the console offers *Try again*, the board keeps its last good data and retries |

RLS `with check` on `votes` also re-verifies the target is `approved` server-
side — the client's opinion of a song's status is never trusted.

---

## 7. Security checklist (all enforced in SQL)

- [x] RLS enabled on all six tables (no `force` — owner/service-role is the
      intentional admin path)
- [x] Public: `SELECT` active catalogue, `SELECT` approved/played requests,
      `INSERT` requests (pending or approved — §4), votes, events —
      **nothing else**
- [x] No public `UPDATE`/`DELETE` anywhere (no policy → no access; blanket
      revoke + tightened default privileges for future tables)
- [x] Column-level grant keeps `visitor_token` off the wire
- [x] `votes` has no public `SELECT`; aggregates only via the view
- [x] DB constraints mirror the UI: title ≤ 160, artist ≤ 120, https-only
      URLs, one row per song id forever
- [x] Rate limits live **in the database**, so curl bypasses nothing
- [x] No service-role key, no secrets, no audio bytes in this repo

---

## 8. Deliberately deferred (next rounds, with this foundation in place)

1. **~~React wiring~~** — shipped; see §10. Still deferred inside it:
   **categories/stations fetch from the database** — the public catalogue is
   still read from the bundled `STATIONS` data (identical content), because
   making it async mid-round would touch every consumer. The tables and admin
   policies exist; it moves to the content-editors round together with
   station CRUD.
2. **~~Admin content editors~~** — shipped: the Catalogue (categories, stations,
   songs CRUD) and Settings (site_settings CRUD) screens live in `/admin`
   (§9). Still deferred inside this round: audio testing and the *site-side*
   catalogue fetch (item 1) — until that ships, the public gallery renders
   from the bundled data while panel edits persist to the database.
3. **Edge Functions** — the rate limits and validations above already run
   server-side for every path; nothing has justified a first function yet. Any
   future one ships written, deployed and tested together with its client, not
   blind.
4. **Retiring a request to `played`** — **decided:** public `UPDATE` stays
   forbidden (§8 of the original plan, kept). When a song airs, the player's
   adapter retires it to *this session's* history (`markPlayed(id, played)`
   keeps a local copy) while the row's `played` status still only an admin
   sets. One visitor's history view stays truthful without opening a global
   write path; the next admin action syncs everyone.
5. **Station events / trending** — table and insert policy exist; emit events
   only when there is traffic worth counting.
6. **Roles beyond `owner`** — **retired with migration 8**: there are no
   identities left to carry roles (`admin_users`, `admin_role()` and
   `is_admin()` are dropped). The panel is open by decision (§9); if that
   decision is ever reversed, roles return as a new migration — not as
   resurrected code.

---

## 9. The admin control room (`/admin`)

> **Status: open panel, no login (migration 8).** The panel ships in
> `src/admin/` and every database rule below is enforced; the app's `/admin`
> route loads its own lazy chunk (never the public bundle) and renders the
> control room directly — there is no gate, no OTP and no role check in the
> UI *or* in the database.

An unlinked, full-control panel in the React app (`src/admin/`). The owner's
explicit decision: **no login of any kind** — no email, no code, no session,
no bootstrap.

```text
/admin → readiness probe (one query) → control room — nothing to sign in to
```

### What's enforced where (migration 8)

| Layer | Decision |
|---|---|
| RLS `*_open_panel` policies (one per managed table) | The panel's reads and writes, open to `anon` + `authenticated` — by design |
| Column grants on `votes` / `station_events` / `song_likes` / `suggestions` | **`visitor_token` has no SELECT grant anywhere** — these tables read back only token-free column lists |
| `log_admin_activity()` trigger (JWT-scoped) | Every browser write is logged — this panel's as `admin_email = 'open panel'`; writes with no JWT (SQL Editor, seeds) stay out |
| React `/admin` | UX only: honest states (not configured / opening / failed + retry) — never the security |

**The tradeoff, stated plainly:** the publishable key ships in the public
bundle, so anyone who inspects it can call these endpoints — read and write
every catalogue row, moderate suggestions, edit settings, read the activity
log. That is what "no checks" means, and it is recorded here rather than
hidden. What still cannot happen: reading `visitor_token` (write-only, no
grant), inflating counts (they stay aggregates — `suggestion_vote_counts`,
`song_like_counts`), or finding secrets in the database (there are none to
store).

### First-time setup

1. Run migration 8 (§1). It retires the old authorization layer —
   `admin_users`, `is_admin()`, `admin_role()` and every `*_admin_all` policy
   are dropped — and opens the panel's tables.
2. Create `.env.local` with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (never the service-role key).
3. Open `/admin` → the readiness probe answers → the control room. Nothing to
   bootstrap, no email to verify.

### What each screen does

- **Dashboard** — live counts (categories/stations/songs, suggestions by
  status, votes, likes, play events) from this page's own queries; system
  status reports only what was actually measured.
- **Suggestions** — moderation: approve, reject, mark played, delete (each
  behind a confirmation), plus per-row **Clear votes** / **Clear likes** when
  a count is non-zero (targeted deletes — counts are aggregates, nothing
  stored needs "fixing"). Reads use the **`request_wall`** view (RLS-applied,
  `visitor_token` excluded); writes stamp `reviewed_at` (there is no identity
  to stamp). Played rows are read-only history.
- **Catalogue** — categories, stations and songs CRUD. Every value is checked
  against the schema's own rules before a write is sent (slug shape, hex
  accents, `https://` sources, provider ↔ playlist pairing); the confirm copy
  states the cascades (a station takes its songs and station votes with it).
  Saves land in the database immediately — the public gallery still renders
  from the bundled data until the catalogue fetch ships (§8 item 1).
- **Settings** — `site_settings` CRUD with type-aware validation
  (text / number / boolean / json) and the public flag per key. Never store
  secrets here: `publicly_visible` keys are readable by any visitor, and this
  panel itself is open.
- **Activity log** — rows written by *database triggers* on categories,
  stations, songs, suggestions and settings. SQL Editor and seed writes (no
  JWT) are deliberately not logged; every browser write is, labelled
  `open panel` for this panel.

### Client and error notes

- The Supabase client runs with `persistSession: false` — there is no session
  to persist — and the panel never writes browser storage directly; it never
  references `service_role`. All three pinned by `tests/adminPanel.test.ts`.
- Error mapping for admin screens: `PGRST202`/`PGRST205`/`42P01`/`42883` →
  "database not ready" with the migration hint; `42501` → the migration hint
  plus *"its policies predate the open panel"* (a database older than
  migration 8); `P0001` surfaces the database's own message (rate limits).

### Admin sitemap

```text
/dashboard   live stats, measured status, quick links    ✅
/suggestions moderation + per-row votes/likes cleanup    ✅
/catalogue   categories · stations · songs CRUD          ✅
/settings    site_settings CRUD                          ✅
/activity    trigger-written audit log                   ✅
audio test · analytics views · site-side catalogue fetch → later (§8)
```

The public site never links here (`href="/admin"` appears nowhere — pinned by
the smoke render); the route exists for the owner and anyone they hand the
URL to.

---

## 10. Public wiring — what ships in the app

The site picks its backend at runtime: **configured browser ⇒ Supabase,
everything else ⇒ the local store.**

| Where | Backend |
|---|---|
| Browser with `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase (shared, realtime) |
| Browser without them | local store — the site works fully offline |
| SSR / smoke render / Node | local store, always — a render never touches the network |

The database backend loads as a lazy chunk (`src/lib/supabase-request-api.ts`
via the `getRequestApi()` seam), so an unconfigured build never downloads
supabase-js; the smoke render proves the unconfigured state even when
`.env.local` exists.

### What runs where

- **Submissions** — insert first; the console shows *sent* only after the row
  comes back from Postgres. Duplicate / rate-limit / RLS errors map through
  §6; anything else is an honest failure with *Try again*.
- **Votes** — one row per song per device in `votes` (unique index + trigger
  limit). “Have I voted?” is remembered on the device
  (`nostalgia-voted-requests`); the `visitor_token` (`nostalgia-visitor-id`)
  is write-only — never read back.
- **Likes** — one row per song per device in `song_likes` (migration 7):
  affection, never a rank. Open on `approved` **and** `played` requests — where
  votes close with airplay — and “Have I liked?” is separate device memory
  (`nostalgia-liked-requests`); same write-only token, same definer rate limit.
- **Counts** — never stored, never invented: read from
  `suggestion_vote_counts` and `song_like_counts` on a light 20 s poll + on
  focus. They deliberately do **not** ride realtime (neither `votes` nor
  `song_likes` has a public SELECT).
- **Rankings & search** — all four tabs (Most Wanted / Rising / Recently
  Added / Played) and the search box run through `wall_board()` in SQL, so
  ordering and limits are identical for every visitor.
- **Realtime** — `suggestions` joins the `supabase_realtime` publication. A
  live channel **supplements** the initial SELECT (which always loads first),
  and quietly falls back to the poll if `wss://` is unreachable (the endpoint
  is already in the CSP `connect-src` in `index.html`).

### Setup

1. Confirm migrations 5, 6, 7 **and** 8 (§1) — 5 for seamless inserts, realtime
   and `wall_board()`; 6 so the rate-limit counters stop rejecting every public
   insert with `42501`; 7 for likes; 8 for the no-login `/admin` (without it
   the panel's writes answer `42501` with the migration hint). All four are
   applied on the live project (§1 holds the verification queries).
2. Local: `.env.example` → `.env.local` → `npm run dev`.
3. **Vercel:** Project → Settings → Environment Variables → add the *same two
   values* (Production) → **Redeploy**. Vite bakes `VITE_*` at build time, so
   a redeploy is mandatory after any env change.

### Acceptance test (two browsers, no code involved)

1. Browser **A** on the deployed site submits a YouTube song → *sent* appears
   only after the insert lands.
2. Browser **B** (another profile/machine) sees it within ~1 s (realtime) or
   ≤20 s (poll fallback).
3. **B** votes → **A**'s ▲ count rises on the next poll/focus (≤20 s). **B**
   taps ♡ LIKE → **A**'s ♥ count rises the same way.
4. Refresh both → the song, the counts and B's `♥ LIKED` state persist.
5. `/admin` → Suggestions → Reject → the row disappears from both walls
   (realtime or next refresh). *(No sign-in: `/admin` opens straight into the
   control room — §9.)*

If any step shows an instant success before the database answered, or a count
nobody voted for, it's a bug — `tests/communityWiring.test.ts` pins each of
these contracts.
