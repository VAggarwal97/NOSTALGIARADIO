-- ============================================================================
-- Nostalgia Radio — song likes: "I enjoyed this", separate from votes
--   ("I want this played").
--
--   WHY A SECOND TABLE: votes rank the community queue; likes are an
--   affection signal that can outlive airplay (a played request stays
--   likable). One row per (request, visitor) — counted only through the
--   `song_like_counts` aggregate view, so the number can never be inflated
--   as a stored column, and `visitor_token` keeps having no public SELECT
--   anywhere, exactly like `votes`.
--
--   Lessons carried over from migrations 1 and 6: the rate counter is born
--   `security definer` with a pinned `search_path` (an invoker counter reads
--   a column anon may never hold), and the grant block states least privilege
--   explicitly instead of trusting default privileges on a new table.
--
--   Idempotent: safe to re-run.
--   Run after 20260930000006_definer_rate_limits.sql.
-- ============================================================================

create table if not exists public.song_likes (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  visitor_token text not null check (length(visitor_token) between 1 and 100),
  created_at    timestamptz not null default now()
);

comment on table public.song_likes is
  'One like per (request, visitor). No public SELECT (tokens stay private); counts publish via song_like_counts.';

-- One like per visitor per request → the 23505 the UI maps to "already liked".
create unique index if not exists song_likes_one_per_suggestion
  on public.song_likes (suggestion_id, visitor_token);

create index if not exists song_likes_suggestion_idx on public.song_likes (suggestion_id);
create index if not exists song_likes_visitor_window_idx on public.song_likes (visitor_token, created_at);

-- Server-side rate limit, definer from day one (the migration 6 lesson): the
-- count reads `visitor_token`, which anon holds no SELECT on. Mirrors the
-- local store's own window in request-api.ts.
create or replace function public.enforce_like_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent integer;
begin
  if new.visitor_token is null then
    return new;
  end if;
  select count(*) into recent
    from public.song_likes
   where visitor_token = new.visitor_token
     and created_at > now() - interval '60 seconds';
  if recent >= 10 then
    raise exception 'rate-limited: at most 10 likes per minute'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.enforce_like_rate() is
  'security definer: counts the caller''s recent likes across the whole table (tokens are never granted to anon) · 10 per visitor per 60s · mirrors request-api.ts';

drop trigger if exists song_likes_rate_limit on public.song_likes;
create trigger song_likes_rate_limit
  before insert on public.song_likes
  for each row execute function public.enforce_like_rate();

-- The only like count a client may ever see: an aggregate over song_likes.
-- Owner rights on purpose (no security_invoker): count without granting
-- SELECT on the rows — visitor tokens never leave the database.
drop view if exists public.song_like_counts;
create view public.song_like_counts as
  select suggestion_id, count(*)::integer as likes
    from public.song_likes
   group by suggestion_id;

comment on view public.song_like_counts is
  'Owner-rights aggregate: the public sees like counts, never who liked what or which token wrote them.';

grant select on public.song_like_counts to anon, authenticated;

-- RLS: likes land only on requests the public wall can already see (an
-- affection signal must not become a probe for hidden moderation states).
alter table public.song_likes enable row level security;

drop policy if exists "public likes visible requests" on public.song_likes;
create policy "public likes visible requests"
  on public.song_likes for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.suggestions s
       where s.id = suggestion_id and s.status in ('approved', 'played')
    )
    and length(visitor_token) between 1 and 100
  );

-- Grants: explicit least privilege for a table created after migration 2's
-- default-privilege tightening — insert is the browser's only verb; select
-- (the token column), update and delete stay revoked.
revoke select, update, delete, truncate on public.song_likes
  from anon, authenticated;
grant insert on public.song_likes to anon, authenticated;
