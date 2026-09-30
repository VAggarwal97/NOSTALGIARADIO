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

Run the five files in `supabase/migrations/` **in this order**. Either way:

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

All six are **idempotent** — re-running any of them is safe.

**Verify afterwards** (SQL Editor):

```sql
select count(*) from public.categories;  -- 8
select count(*) from public.stations;    -- 37
select count(*) from public.songs;       -- 0 (by design, for later phases)
select count(*) from public.admin_users; -- 0 until you bootstrap (§9)
select relrowsecurity from pg_class where relname in
  ('categories','stations','songs','suggestions','votes','station_events',
   'admin_users','admin_activity_logs','site_settings');
-- 9 rows, all true

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
  git-ignored): needed by the admin gate (§9) and the public wall (§10).
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
   paths run through the same RLS; only an active `admin_users` identity can.
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
2. **Admin content editors** — categories, stations and songs CRUD, audio
   testing, homepage/featured/settings/SEO screens: the tables, admin policies
   and the trigger-written activity log already support them (§9); the screens
   ship next. Until then the Table Editor covers content changes.
3. **Edge Functions** — the rate limits and validations above already run
   server-side for every path; the first justified function is an admin-OTP
   pre-check (reject non-allowlisted addresses *before* an email is sent),
   written, deployed and tested together with its client, not shipped blind.
4. **Retiring a request to `played`** — **decided:** public `UPDATE` stays
   forbidden (§8 of the original plan, kept). When a song airs, the player's
   adapter retires it to *this session's* history (`markPlayed(id, played)`
   keeps a local copy) while the row's `played` status still only an admin
   sets. One visitor's history view stays truthful without opening a global
   write path; the next admin action syncs everyone.
5. **Station events / trending** — table and insert policy exist; emit events
   only when there is traffic worth counting.
6. **Roles beyond `owner`** — `admin_users.role` (owner/admin/editor/moderator)
   and `admin_role()` exist; policies currently treat every active admin as
   full-access. Enforce per-role grants when a second person gets access.

---

## 9. The admin control room (`/admin`)

A private, unlinked panel in the React app (`src/admin/`). No login page, no
signup, no password — exactly the flow you specified:

```text
/admin → authorized email → one-time code (Supabase Auth) → is_admin()? → dashboard
```

### What's enforced where

| Layer | Decision |
|---|---|
| Supabase Auth | Identity: passwordless email OTP, no registration UI |
| `admin_users` + `is_admin()` (security definer) | *Who* counts as admin — active row only |
| RLS `*_admin_all` policies | What an admin may do: full CRUD on all nine tables |
| React `/admin` | UX only: gate, screens, copy — never the security |

A bypassed or hand-crafted client with the publishable key still fails every
query: no `admin_users` row → no policy matches → nothing readable or
writable. Unknown emails receive the same refusal (no enumeration).

### First-time setup

1. Run migration 4 (§1).
2. Create `.env.local` with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (never the service-role key).
3. Supabase dashboard → **Authentication → Email** must be enabled (it is by
   default; the built-in SMTP handles a single admin's codes fine). Make sure
   the Magic Link template contains `{{ .Token }}` — that's the 6-digit code
   the gate asks for. (If it contains only a link, clicking it also works when
   **Authentication → URL Configuration → Site URL** points at your `/admin`.)
4. **Bootstrap the owner** — open `/admin`, sign in with your email (you'll see
   *Access denied* once — correct: no row exists yet), then run:

```sql
insert into public.admin_users (id, email, role)
select id, email, 'owner' from auth.users
 where lower(email) = 'you@example.com'
on conflict (id) do nothing;
```

5. Open `/admin` again → verified → dashboard.

### What each screen does

- **Dashboard** — live counts (categories/stations/songs/suggestions by
  status/votes) from this page's own queries; system status reports only what
  was actually measured.
- **Suggestions** — moderation: approve, reject, mark played, delete (with a
  confirmation step). Reads use the **`request_wall`** view (RLS-applied,
  `visitor_token` excluded); writes hit `suggestions` and stamp
  `reviewed_at`/`reviewed_by`. Played rows are read-only: history never
  re-enters the queue.
- **Activity log** — rows written by *database triggers* on categories,
  stations, songs, suggestions, settings and admin_users. SQL Editor writes
  (no JWT) are deliberately not logged; a `last_login_at` change logs as
  `sign in`.

### Session and storage notes

- The session lives in `localStorage` under `nostalgia-admin-session`
  (Supabase Auth's standard persistence) — **admin only**; the public site
  still writes nothing to storage.
- Frontend code never writes storage directly and never references
  `service_role` — both pinned by `tests/adminPanel.test.ts`.
- Error mapping for admin screens: `PGRST202`/`PGRST205`/`42P01`/`42883` →
  “database not ready” with the migration hint; `42501` → the session is
  demoted to *Access denied*; `P0001` surfaces the database's own message
  (rate limits).

### Admin sitemap — what ships when

```text
/auth        access gate, OTP, session          ✅ this round
/dashboard   live stats, status, quick actions   ✅ this round
/suggestions moderation queue                    ✅ this round
/activity    trigger-written audit log           ✅ this round
categories · stations · songs · audio test       → next round (tables + policies ready)
homepage · featured · links · donation · SEO     → next (site_settings ready)
votes view · analytics · audio health            → later
roles enforcement · admin users screen · OTP     → later
  pre-check (Edge Function)
```

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
- **Counts** — never stored, never invented: read from
  `suggestion_vote_counts` on a light 20 s poll + on focus. They deliberately
  do **not** ride realtime (`votes` has no public SELECT).
- **Rankings & search** — all four tabs (Most Wanted / Rising / Recently
  Added / Played) and the search box run through `wall_board()` in SQL, so
  ordering and limits are identical for every visitor.
- **Realtime** — `suggestions` joins the `supabase_realtime` publication. A
  live channel **supplements** the initial SELECT (which always loads first),
  and quietly falls back to the poll if `wss://` is unreachable (the endpoint
  is already in the CSP `connect-src` in `index.html`).

### Setup

1. Apply migrations 5 **and** 6 (§1) — 5 for seamless inserts, realtime and
   `wall_board()`; 6 so the rate-limit counters stop rejecting every public
   insert with `42501`.
2. Local: `.env.example` → `.env.local` → `npm run dev`.
3. **Vercel:** Project → Settings → Environment Variables → add the *same two
   values* (Production) → **Redeploy**. Vite bakes `VITE_*` at build time, so
   a redeploy is mandatory after any env change.

### Acceptance test (two browsers, no code involved)

1. Browser **A** on the deployed site submits a YouTube song → *sent* appears
   only after the insert lands.
2. Browser **B** (another profile/machine) sees it within ~1 s (realtime) or
   ≤20 s (poll fallback).
3. **B** votes → **A**'s count rises on the next poll/focus (≤20 s).
4. Refresh both → the song and counts persist.
5. `/admin` → Suggestions → Reject → the row disappears from both walls
   (realtime or next refresh).

If any step shows an instant success before the database answered, or a count
nobody voted for, it's a bug — `tests/communityWiring.test.ts` pins each of
these contracts.
