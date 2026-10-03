-- Migration 10 — live catalogue publication.
--
-- The public site hydrates its catalogue (categories, stations, songs) and
-- settings from the database at runtime so /admin edits appear without a
-- rebuild. Realtime makes that convergence instant; the client also refetches
-- on focus as the offline fallback. RLS still decides what each subscriber
-- may see (active categories/stations/songs, publicly visible settings), so
-- publication membership widens delivery, never visibility.
--
-- Idempotent: guarded per table, and safe to re-run if a concurrent applier
-- added the same table first.

do $$
declare
  t text;
begin
  foreach t in array array['categories', 'stations', 'songs', 'site_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when duplicate_object then null; -- raced with a concurrent applier
end $$;
