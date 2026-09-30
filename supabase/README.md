# Supabase — community backend foundation

Nostalgia Radio's public experience stays a login-free radio. This directory is
the **secure foundation** that sits behind it: catalogue + community tables,
row-level security, indexes, server-side rate limits and the generated seed.
The React app is **not connected yet** — it keeps running on the local request
store until the wiring round, so nothing here can break the site.

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

Run the three files in `supabase/migrations/` **in this order**. Either way:

**SQL Editor (simplest):** Dashboard → SQL Editor → New query → paste each file
whole → Run. Repeat for the next file.

**CLI:** `supabase link --project-ref kgeeikjpjydotawjilvs` then
`supabase db push` (requires the Supabase CLI and your database password).

| # | File | What it does |
|---|------|--------------|
| 1 | `20260930000001_foundation_schema.sql` | Tables, CHECK constraints, indexes, rate-limit triggers, `suggestion_vote_counts` view |
| 2 | `20260930000002_rls_policies.sql` | Row Level Security, least-privilege grants |
| 3 | `20260930000003_seed_catalogue.sql` | 8 categories + 37 stations (generated — see §5) |

All three are **idempotent** — re-running any of them is safe.

**Verify afterwards** (SQL Editor):

```sql
select count(*) from public.categories;  -- 8
select count(*) from public.stations;    -- 37
select count(*) from public.songs;       -- 0 (by design, for later phases)
select relrowsecurity from pg_class where relname in
  ('categories','stations','songs','suggestions','votes','station_events');
-- 6 rows, all true
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
  git-ignored) when the wiring round begins.
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
wall's existing terms (used at wiring time) is:

| Database `suggestions.status` | Wall sees it as | Publicly visible |
|---|---|---|
| `pending` | *(awaiting moderation)* | No |
| `approved` | `open` (votable, queue-eligible) | Yes |
| `played` | `played` (history, never replays) | Yes |
| `rejected` | `unavailable` (refused) | No |

---

## 4. Moderation workflow (no admin panel needed yet)

1. A visitor submits → row lands as **`pending`** with `status` locked by RLS
   (the public cannot insert any other value).
2. You approve it in **Table Editor → suggestions → status → approved**.
3. It appears on the wall and joins the community queue ranking.
4. When it airs, its status moves to **`played`** + `played_at` set.

**Seamless mode** (skip step 2 — behaves like V1, everything immediately
votable):

```sql
alter table public.suggestions alter column status set default 'approved';
```

Flip back with `set default 'pending'` at any time.

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

## 6. Error mapping for the wiring round

The client will translate database signals into the existing failure
vocabulary (`src/lib/request-api.ts` — `duplicate`, `already-voted`,
`rate-limited`, `not-found`, `unavailable`):

| UI failure | Database signal |
|---|---|
| `duplicate` / `already-voted` | `23505` unique_violation (`suggestions_one_per_song`, `votes_one_per_suggestion`) |
| `rate-limited` | message starts with `rate-limited:` (triggers: 3 suggestions/60 s, 10 votes/60 s per token) |
| `not-found` | `23503` foreign_key_violation on `votes.suggestion_id` |
| `unavailable` | RLS violation `42501` (vote aimed at a pending/rejected suggestion or inactive station) |
| moderation wait | row stays `pending`; the wall simply doesn't receive it until approved |

RLS `with check` on `votes` also re-verifies the target is `approved` server-
side — the client's opinion of a song's status is never trusted.

---

## 7. Security checklist (all enforced in SQL)

- [x] RLS enabled on all six tables (no `force` — owner/service-role is the
      intentional admin path)
- [x] Public: `SELECT` active catalogue, `SELECT` approved/played requests,
      `INSERT` pending requests/votes/events — **nothing else**
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

1. **React wiring** — replace the local store through the existing
   `getRequestApi()` seam (categories/stations fetch, votes, suggestions),
   with `.env.local` credentials and a local fallback when they're absent.
2. **Edge Functions** — the rate limits and validations above already run
   server-side for every path, so functions add nothing until a client calls
   them; they should be written, deployed *and tested* together with that
   client (`supabase functions deploy vote`), not shipped blind.
3. **Retiring a request to `played` from the client** — public `UPDATE` is
   correctly forbidden, so the queue's auto-retire needs either an authenticated
   admin path or an accepted-risk RPC. Real decision, made at wiring time with
   both options on the table — not faked now.
4. **Station events / trending** — table and insert policy exist; emit events
   only when there is traffic worth counting.
