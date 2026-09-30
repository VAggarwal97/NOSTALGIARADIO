-- ============================================================================
-- Nostalgia Radio — row level security + least-privilege grants
--   Public (anon) surface, in full:
--     SELECT   categories · stations · songs (active rows only)
--     SELECT   suggestions (approved/played only; visitor_token column not granted)
--     SELECT   suggestion_vote_counts (aggregates, never tokens)
--     INSERT   suggestions (status forced to pending) · votes · station_events
--   Everything else — UPDATE, DELETE, admin transitions — has NO policy and
--   NO grant, so the browser cannot touch it at all. Service role and the
--   SQL Editor (postgres) keep full access for moderation and seeding.
--
-- Idempotent: safe to re-run.
-- Run after 20260930000001_foundation_schema.sql.
-- ============================================================================

alter table public.categories     enable row level security;
alter table public.stations       enable row level security;
alter table public.songs          enable row level security;
alter table public.suggestions    enable row level security;
alter table public.votes          enable row level security;
alter table public.station_events enable row level security;

-- Note: no `force` — the table owner (postgres / service role) intentionally
-- bypasses RLS. That is the moderation and seeding path.

-- ----------------------------------------------------------------------------
-- Catalogue: public reads what is active, nothing else.
-- ----------------------------------------------------------------------------
drop policy if exists "public reads active categories" on public.categories;
create policy "public reads active categories"
  on public.categories for select
  to anon, authenticated
  using (active = true);

drop policy if exists "public reads active stations" on public.stations;
create policy "public reads active stations"
  on public.stations for select
  to anon, authenticated
  using (active = true);

drop policy if exists "public reads active songs" on public.songs;
create policy "public reads active songs"
  on public.songs for select
  to anon, authenticated
  using (active = true);

-- ----------------------------------------------------------------------------
-- Suggestions: read the public wall, submit new rows. Moderation and status
-- transitions (approve / reject / mark played) have NO public policy.
-- ----------------------------------------------------------------------------
drop policy if exists "public reads approved or played requests" on public.suggestions;
create policy "public reads approved or played requests"
  on public.suggestions for select
  to anon, authenticated
  using (status in ('approved', 'played'));

drop policy if exists "public submits pending requests" on public.suggestions;
create policy "public submits pending requests"
  on public.suggestions for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and visitor_token is not null
    and length(visitor_token) <= 100
  );

-- ----------------------------------------------------------------------------
-- Votes: insert only, and only onto targets that are actually live.
-- The sub-selects run under this same role, so they only ever see rows the
-- SELECT policies above allow — a vote on a pending/rejected suggestion or an
-- inactive station is refused by RLS (surfaced as 42501).
-- No SELECT policy: visitor tokens never leave the database.
-- ----------------------------------------------------------------------------
drop policy if exists "public votes on live targets" on public.votes;
create policy "public votes on live targets"
  on public.votes for insert
  to anon, authenticated
  with check (
    (suggestion_id is null or exists (
      select 1 from public.suggestions s
       where s.id = suggestion_id and s.status = 'approved'
    ))
    and (station_id is null or exists (
      select 1 from public.stations st
       where st.id = station_id and st.active = true
    ))
    and length(visitor_token) between 1 and 100
  );

-- ----------------------------------------------------------------------------
-- Station events: write-only background analytics on active stations.
-- ----------------------------------------------------------------------------
drop policy if exists "public records events on active stations" on public.station_events;
create policy "public records events on active stations"
  on public.station_events for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.stations st
       where st.id = station_id and st.active = true
    )
    and (visitor_token is null or length(visitor_token) <= 100)
  );

-- ----------------------------------------------------------------------------
-- Grants — explicit, minimal, and applied to future tables too.
-- (Supabase's default privileges may be broad; this block is the truth.)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke insert, update, delete, truncate on all tables in schema public
  from anon, authenticated;

-- Tokens must not be readable even though RLS already hides the rows.
revoke select on public.votes, public.station_events, public.suggestions
  from anon, authenticated;

grant select on public.categories, public.stations, public.songs,
  public.suggestion_vote_counts to anon, authenticated;

-- Column-level SELECT: the wall gets everything it renders except the token.
grant select (
  id, song_url, provider, provider_id, title, artist, artwork_url,
  description, station_id, status, played_at, created_at, updated_at
) on public.suggestions to anon, authenticated;

grant insert on public.suggestions, public.votes, public.station_events
  to anon, authenticated;

-- Tighten defaults for any table created from now on; each future migration
-- grants exactly what its public features need.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;
