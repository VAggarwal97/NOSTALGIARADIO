-- ============================================================================
-- Nostalgia Radio — open panel (migration 8)
--
--   The /admin control room has no login: no OTP, no admin_users row, no role
--   check — in the UI or in the database. This file retires the authorization
--   layer from migration 4 and opens the panel's tables to the publishable
--   key. That is the owner's explicit decision, and the tradeoff is real:
--   the anon key ships in the public bundle, so everything opened here is
--   reachable by anyone who inspects it. What stays closed by construction:
--
--     * visitor_token keeps having no SELECT grant anywhere — votes,
--       song_likes and station_events are readable only through explicit
--       token-free column lists; the token columns stay write-only.
--     * counts stay aggregates (suggestion_vote_counts / song_like_counts);
--       no stored count columns appear.
--     * the audit log stays trigger-written: writes with no JWT (SQL Editor,
--       seeds, migrations) remain outside it; panel writes log as 'open panel'.
--
--   What it does:
--     1. retires the authorization layer — is_admin() policies are dropped
--        FIRST (they parse the functions), then admin_users, is_admin(),
--        admin_role()
--     2. opens every managed table to anon + authenticated with one policy
--     3. grants anon exactly the panel's verbs: table DML on the content
--        tables, token-free column reads + targeted deletes on votes /
--        song_likes, insert+select on the audit log (the activity trigger
--        writes as the calling role, so anon needs that insert itself)
--     4. rewrites log_admin_activity() so open-panel (anon) changes are
--        recorded instead of skipped
--
--   Idempotent: safe to re-run.
--   Run after 20261002000007_song_likes.sql.
-- ============================================================================

-- 1) Retire the authorization layer ------------------------------------------
-- Policies first: they parse is_admin(), and a policy whose function is gone
-- breaks every future query on that table.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories', 'stations', 'songs', 'suggestions', 'votes', 'station_events',
    'site_settings', 'admin_users', 'admin_activity_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_admin_all', tbl);
  end loop;
end $$;

drop table if exists public.admin_users cascade;
drop function if exists public.is_admin();
drop function if exists public.admin_role();

-- 2) Open policies — one per managed table, both browser roles ---------------
-- Policy per table (not per command): the panel edits rows in place, inserts
-- catalogue rows, moderates statuses, clears votes/likes and writes settings.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories', 'stations', 'songs', 'suggestions', 'votes', 'station_events',
    'site_settings', 'admin_activity_logs', 'song_likes'
  ] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_open_panel', tbl);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      tbl || '_open_panel', tbl
    );
  end loop;
end $$;

-- 3) Grants — the panel's verbs, exactly -------------------------------------
-- Content tables: anon had only INSERT on suggestions/votes/station_events
-- (migration 2) and no DML at all on the catalogue/settings tables.
grant insert, update, delete on public.categories, public.stations, public.songs
  to anon;
grant update, delete on public.suggestions to anon;      -- insert already granted
grant insert, update, delete on public.site_settings to anon;

-- The activity trigger is not security definer: it writes as the calling
-- role, so the open panel needs insert itself. Reads power the log page.
grant insert, select on public.admin_activity_logs to anon;

-- Token-free reads (the moderation tools) + the two targeted deletes the
-- panel offers. visitor_token appears in NO grant — it stays write-only.
grant select (id, suggestion_id, station_id, created_at) on public.votes to anon;
grant delete on public.votes to anon;
grant select (id, suggestion_id, created_at) on public.song_likes to anon;
grant delete on public.song_likes to anon;
grant select (id, station_id, event_type, created_at) on public.station_events to anon;

-- 4) The audit log records open-panel changes --------------------------------
-- Migration 4 skipped every write without auth.uid(), which would have made
-- the open panel invisible to its own log. The session test is now "is there
-- a JWT at all": SQL Editor and seeds carry none; every browser request —
-- anon included — does.
create or replace function public.log_admin_activity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  claims       jsonb;
  actor        uuid;
  payload      jsonb;
  previous     jsonb;
  action       text := lower(TG_OP) || ' ' || TG_TABLE_NAME;
  entity_label text;
  detail       jsonb;
begin
  claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  if claims = '{}'::jsonb then
    return null;                       -- no session: seeds and SQL Editor stay out
  end if;

  actor := auth.uid();                 -- null on the open panel; the log still writes

  payload  := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  previous := case when TG_OP = 'INSERT'  then null else to_jsonb(old) end;

  if TG_TABLE_NAME = 'suggestions' and TG_OP = 'UPDATE'
     and (payload ->> 'status') is distinct from (previous ->> 'status') then
    action := 'review suggestion';
  end if;

  entity_label := coalesce(
    payload ->> 'slug',
    payload ->> 'title',
    payload ->> 'setting_key',
    payload ->> 'id'
  );

  detail := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
  if TG_TABLE_NAME = 'suggestions' and TG_OP = 'UPDATE'
     and (payload ->> 'status') is distinct from (previous ->> 'status') then
    detail := detail || jsonb_build_object(
      'from_status', previous ->> 'status',
      'to_status', payload ->> 'status'
    );
  end if;

  insert into public.admin_activity_logs
    (admin_id, admin_email, action, entity_type, entity_label, detail)
  values
    (actor, coalesce(claims ->> 'email', 'open panel'), action,
     TG_TABLE_NAME, left(entity_label, 200), detail);

  return null;
end;
$$;

comment on function public.log_admin_activity() is
  'Audit trail writer. Skips JWT-less writes (SQL Editor, seeds); every browser write is recorded, anon panel writes as ''open panel''. Not security definer: it needs anon''s insert grant on the log, granted above.';
