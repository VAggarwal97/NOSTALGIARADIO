-- ============================================================================
-- Nostalgia Radio — public wiring round (migration 5)
--
--   1. Seamless submissions — new public requests land as `approved`, so a
--      suggestion is visible and votable by everyone the moment it is sent
--      (the two-browser reality of a community wall). Moderation keeps every
--      power it has: reject, delete, mark played, set pending. To restore
--      strict pre-moderation, run the two statements in supabase/README.md §4.
--
--   2. The public INSERT policy widens to match the default — the row RLS
--      checks with `with check` is the row AFTER defaults apply, so the old
--      `status = 'pending'` check would refuse every seamless insert.
--
--   3. Realtime — `suggestions` joins the supabase_realtime publication so an
--      open wall hears about new requests (and admin status changes) without
--      polling. Vote COUNTS deliberately do NOT ride realtime: `votes` has no
--      public SELECT policy and is never added to a publication — tokens stay
--      in the database. The client converges on counts via its light poll of
--      `suggestion_vote_counts`.
--
--   4. wall_board() — the board's query (tab ordering, substring search, a
--      clamped limit) runs in the database instead of shipping rows to the
--      browser. Security definer with a pinned search_path; the visible rows
--      are hardcoded to exactly what RLS already exposes (approved / played);
--      `visitor_token` is never selected.
--
-- Idempotent: safe to re-run.
-- Run after 20260930000004_admin_panel.sql.
-- ============================================================================

-- 1. Seamless default -------------------------------------------------------
--    (The moderation-first alternative lives in supabase/README.md §4.)
alter table public.suggestions alter column status set default 'approved';

comment on column public.suggestions.status is
  'approved = default for public inserts: visible and votable immediately · pending = pre-moderation hold (restore by setting the column default back to pending, see README §4) · played = aired to history (never replays) · rejected = refused (invisible)';

-- 2. Public submissions: pending OR approved, nothing else ------------------
drop policy if exists "public submits pending requests" on public.suggestions;
drop policy if exists "public submits requests" on public.suggestions;

create policy "public submits requests"
  on public.suggestions for insert
  to anon, authenticated
  with check (
    status in ('pending', 'approved')
    and visitor_token is not null
    and length(visitor_token) <= 100
  );

-- 3. Realtime for the wall (idempotent; skips quietly if the publication is
--    absent — polling keeps working either way).
do $$
begin
  if exists (
      select 1 from pg_publication where pubname = 'supabase_realtime'
    )
    and not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'suggestions'
    ) then
    execute 'alter publication supabase_realtime add table public.suggestions';
  end if;
end $$;

-- 4. The board query, server-side ------------------------------------------
create or replace function public.wall_board(
  p_tab text default 'wanted',
  p_query text default '',
  p_limit integer default 60
)
returns table (
  id            uuid,
  song_url      text,
  provider      text,
  provider_id   text,
  title         text,
  artist        text,
  artwork_url   text,
  station_id    uuid,
  status        text,
  played_at     timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz,
  votes         integer,
  last_voted_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with counts as (
    select suggestion_id,
           count(*)::integer as votes,
           max(created_at) as last_voted_at
      from public.votes
     where suggestion_id is not null
     group by suggestion_id
  )
  select s.id,
         s.song_url,
         s.provider,
         s.provider_id,
         s.title,
         s.artist,
         s.artwork_url,
         s.station_id,
         s.status,
         s.played_at,
         s.created_at,
         s.updated_at,
         coalesce(c.votes, 0) as votes,
         c.last_voted_at
    from public.suggestions s
    left join counts c on c.suggestion_id = s.id
   where (
     case
       when p_tab = 'played' then s.status = 'played'
       when p_tab = 'rising' then s.status = 'approved'
                                and c.last_voted_at is not null
       else s.status = 'approved'
     end
   )
   and (
     btrim(coalesce(p_query, '')) = ''
     or position(lower(btrim(p_query)) in lower(coalesce(s.title, ''))) > 0
     or position(lower(btrim(p_query)) in lower(coalesce(s.artist, ''))) > 0
   )
   order by
     case when p_tab = 'wanted' then coalesce(c.votes, 0) end desc nulls last,
     case when p_tab = 'rising' then c.last_voted_at end desc nulls last,
     case when p_tab = 'recent' then s.created_at end desc nulls last,
     case when p_tab = 'played' then s.played_at end desc nulls last,
     coalesce(c.votes, 0) desc,
     s.created_at asc
   limit least(greatest(coalesce(p_limit, 60), 1), 60);
$$;

comment on function public.wall_board(text, text, integer) is
  'Public community-board query: tab ordering, substring search and a clamped limit (1..60) all run in the database. Definer rights with a pinned search_path; visibility hardcoded to the rows RLS already exposes (approved / played); visitor_token never selected.';

revoke execute on function public.wall_board(text, text, integer) from public;
grant execute on function public.wall_board(text, text, integer)
  to anon, authenticated, service_role;
