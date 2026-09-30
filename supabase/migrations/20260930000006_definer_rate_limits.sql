-- ============================================================================
-- Nostalgia Radio — rate-limit triggers run with owner rights (security definer)
--
--   WHY: enforce_suggestion_rate / enforce_vote_rate count a visitor's recent
--   rows by reading `visitor_token` — a column migration 2 deliberately never
--   grants to anon (tokens live only in the database). Written as plain
--   invoker functions, they inherited the browser role's privileges, so every
--   public insert died BEFORE the row existed:
--
--     42501  permission denied for table suggestions
--     hint   GRANT SELECT ON public.suggestions TO anon
--
--   SECURITY DEFINER lets the table owner (postgres) do the counting while the
--   public grant surface stays exactly as tight as before: anon gains no
--   privilege, and visitor_token still has no public SELECT anywhere.
--   Fixed SQL only (no dynamic input) — the definer surface is a bare count,
--   and `search_path` is pinned so nothing can be hijacked through the path.
--
--   Idempotent: safe to re-run.
--   Run after 20260930000005_public_wiring.sql.
-- ============================================================================

create or replace function public.enforce_suggestion_rate()
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
    from public.suggestions
   where visitor_token = new.visitor_token
     and created_at > now() - interval '60 seconds';
  if recent >= 3 then
    raise exception 'rate-limited: at most 3 suggestions per minute'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.enforce_suggestion_rate() is
  'security definer: counts the caller''s recent suggestions across the whole table (tokens are never granted to anon) · 3 per visitor per 60s · mirrors request-api.ts';

create or replace function public.enforce_vote_rate()
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
    from public.votes
   where visitor_token = new.visitor_token
     and created_at > now() - interval '60 seconds';
  if recent >= 10 then
    raise exception 'rate-limited: at most 10 votes per minute'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.enforce_vote_rate() is
  'security definer: counts the caller''s recent votes across the whole table (tokens are never granted to anon) · 10 per visitor per 60s · mirrors request-api.ts';
