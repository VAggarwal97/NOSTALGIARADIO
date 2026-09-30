-- ============================================================================
-- Nostalgia Radio — admin panel foundation
--   admin_users              authorization identities (roles live here, never passwords)
--   admin_activity_logs      automatic audit trail (database-side, cannot be skipped)
--   site_settings            key/value website configuration (public sees only flagged keys)
--   request_wall             token-free read view over suggestions
--   is_admin() / admin_role() security-definer checks that break the RLS chicken-egg
--   admin policies           full CRUD for active admins on every table, nobody else
--
-- Security model
--   * Authentication = Supabase Auth (passwordless email OTP). This file only
--     decides what an *authenticated identity* may do: nothing, unless its
--     row in admin_users is active.
--   * visitor_token is never granted to any browser role — admins read the
--     request_wall view / explicit columns, tokens stay database-side.
--   * SQL Editor (postgres, no JWT) bypasses RLS by design: that is the
--     bootstrap and moderation path, and it is deliberately excluded from the
--     activity log (auth.uid() is null there).
--   * Bootstrap the first owner once, after their first OTP sign-in:
--       insert into public.admin_users (id, email, role)
--       select id, email, 'owner' from auth.users
--        where lower(email) = 'you@example.com'
--       on conflict (id) do nothing;
--
-- Run after 20260930000003_seed_catalogue.sql. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ADMIN USERS — who may enter, and with which role. The auth identity itself
-- belongs to Supabase Auth; this table stores authorization only.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_users (
  id            uuid primary key,              -- = auth.users.id (the verified identity)
  email         text not null unique
                  check (email = btrim(lower(email)) and length(email) between 3 and 254),
  role          text not null default 'admin'
                  check (role in ('owner', 'admin', 'editor', 'moderator')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table public.admin_users is
  'Authorization rows for the /admin panel. No passwords here — Supabase Auth owns identity, RLS asks is_admin().';

-- ----------------------------------------------------------------------------
-- ACTIVITY LOG — one row per administrative change, written by triggers so a
-- modified client cannot skip it. Never stores authentication secrets.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_activity_logs (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid,                              -- auth.uid(); no FK (the log outlives identities)
  admin_email  text check (admin_email is null or length(admin_email) <= 254),
  action       text not null check (length(action) between 1 and 64),
  entity_type  text check (entity_type is null or length(entity_type) <= 64),
  entity_label text check (entity_label is null or length(entity_label) <= 200),
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_activity_logs_created_idx
  on public.admin_activity_logs (created_at desc);

comment on table public.admin_activity_logs is
  'Audit trail: sign-ins and every content/settings change. Populated by database triggers.';

-- ----------------------------------------------------------------------------
-- SITE SETTINGS — controlled key/value config (hero copy, donation link, SEO,
-- maintenance mode…). Public rows must be explicitly flagged; secrets never
-- belong here (see supabase/README.md).
-- ----------------------------------------------------------------------------
create table if not exists public.site_settings (
  setting_key      text primary key
                     check (setting_key ~ '^[a-z0-9_]+$' and length(setting_key) <= 64),
  setting_value    text not null check (length(setting_value) <= 2000),
  value_type       text not null default 'text'
                     check (value_type in ('text', 'number', 'boolean', 'json')),
  publicly_visible boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       uuid                            -- auth.uid() of the last editor
);

comment on column public.site_settings.publicly_visible is
  'true = the public site may read this key. Never flag a key that names an admin, email or secret.';

-- ----------------------------------------------------------------------------
-- SUGGESTIONS — moderation metadata (who reviewed, when).
-- ----------------------------------------------------------------------------
alter table public.suggestions add column if not exists reviewed_at timestamptz;
alter table public.suggestions add column if not exists reviewed_by uuid;

-- ----------------------------------------------------------------------------
-- AUTHORIZATION HELPERS — security definer so the check can read admin_users
-- through its own RLS (the classic chicken-and-egg). Executed only by
-- authenticated users: PUBLIC and anon are explicitly revoked.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
     where id = (select auth.uid())
       and active = true
  );
$$;

create or replace function public.admin_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role from public.admin_users
   where id = (select auth.uid())
     and active = true;
$$;

revoke execute on function public.is_admin() from public;
revoke execute on function public.admin_role() from public;
grant execute on function public.is_admin(), public.admin_role()
  to authenticated, service_role;

comment on function public.is_admin() is
  'Server-side authorization probe for RLS. Frontend checks are UX only; this is the gate.';

-- ----------------------------------------------------------------------------
-- REQUEST WALL — public/admin read surface over suggestions WITHOUT the
-- visitor token. security_invoker keeps every base-table RLS policy in force
-- (pending/rejected rows stay invisible to the public).
-- ----------------------------------------------------------------------------
drop view if exists public.request_wall;
create view public.request_wall with (security_invoker = on) as
  select id, song_url, provider, provider_id, title, artist, artwork_url,
         description, station_id, status, played_at, reviewed_at, reviewed_by,
         created_at, updated_at
    from public.suggestions;

comment on view public.request_wall is
  'Suggestions as the wall sees them: RLS-applied, visitor_token never exposed.';

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY on the new tables.
-- ----------------------------------------------------------------------------
alter table public.admin_users         enable row level security;
alter table public.admin_activity_logs enable row level security;
alter table public.site_settings       enable row level security;

-- Admin full access — the single policy that makes an admin an admin.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories', 'stations', 'songs', 'suggestions', 'votes', 'station_events',
    'site_settings', 'admin_users', 'admin_activity_logs'
  ] loop
    execute format(
      'drop policy if exists %I on public.%I', tbl || '_admin_all', tbl
    );
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_admin()) with check (public.is_admin())',
      tbl || '_admin_all', tbl
    );
  end loop;
end $$;

-- Every admin may read their own row (dashboard identity); nobody else reads the list.
drop policy if exists "admin_users self read" on public.admin_users;
create policy "admin_users self read"
  on public.admin_users for select
  to authenticated
  using (id = (select auth.uid()));

-- Public reads of flagged settings only (hero copy, donation link, SEO, maintenance).
drop policy if exists "public reads visible settings" on public.site_settings;
create policy "public reads visible settings"
  on public.site_settings for select
  to anon, authenticated
  using (publicly_visible = true);

-- ----------------------------------------------------------------------------
-- GRANTS — privileges first, RLS decides the rows. Everything below is either
-- (a) the new tables, (b) write privileges that only the admin policy can use,
-- or (c) read surfaces that carry no public row policy (admin-only rows).
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.admin_users to authenticated;
grant select, insert, update, delete on public.admin_activity_logs to authenticated;
grant select, insert, update, delete on public.site_settings to authenticated;
grant select on public.site_settings to anon;

-- Writes on the content tables: only authenticated, and the admin policies
-- above decide whether any row may actually change.
grant insert, update, delete on public.categories, public.stations, public.songs,
  public.suggestions, public.votes, public.station_events to authenticated;

-- No public select policy exists on these two, so row access stays admin-only.
grant select on public.votes, public.station_events to authenticated;

-- Suggestions: full read surface minus the token (the token has no grant for
-- any browser role — it lives only in the database).
grant select (
  id, song_url, provider, provider_id, title, artist, artwork_url,
  description, station_id, status, played_at, reviewed_at, reviewed_by,
  created_at, updated_at
) on public.suggestions to anon, authenticated;
grant select on public.request_wall to anon, authenticated;

-- ----------------------------------------------------------------------------
-- updated_at stays honest on the new tables.
-- ----------------------------------------------------------------------------
drop trigger if exists site_settings_touch_updated on public.site_settings;
create trigger site_settings_touch_updated
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- ACTIVITY TRIGGERS — fire for every insert/update/delete on managed tables.
-- Rows written without a JWT (SQL Editor, seeds) are skipped on purpose, and a
-- sign-in shows up as its own action when last_login_at moves.
-- ----------------------------------------------------------------------------
create or replace function public.log_admin_activity()
returns trigger
language plpgsql
as $$
declare
  actor        uuid := auth.uid();
  payload      jsonb;
  previous     jsonb;
  action       text := lower(TG_OP) || ' ' || TG_TABLE_NAME;
  entity_label text;
  detail       jsonb;
begin
  if actor is null then
    return null;                       -- not a session: seeds and SQL Editor stay out of the log
  end if;

  payload  := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  previous := case when TG_OP = 'INSERT'  then null else to_jsonb(old) end;

  if TG_TABLE_NAME = 'admin_users' and TG_OP = 'UPDATE'
     and (payload ->> 'last_login_at') is distinct from (previous ->> 'last_login_at') then
    action := 'sign in';
  end if;

  if TG_TABLE_NAME = 'suggestions' and TG_OP = 'UPDATE'
     and (payload ->> 'status') is distinct from (previous ->> 'status') then
    action := 'review suggestion';
  end if;

  entity_label := coalesce(
    payload ->> 'slug',
    payload ->> 'title',
    payload ->> 'setting_key',
    payload ->> 'email',
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
    (actor, coalesce(auth.jwt() ->> 'email', 'unknown'), action,
     TG_TABLE_NAME, left(entity_label, 200), detail);

  return null;
end;
$$;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories', 'stations', 'songs', 'suggestions', 'site_settings', 'admin_users'
  ] loop
    execute format(
      'drop trigger if exists %I_log_activity on public.%I', tbl, tbl
    );
    execute format(
      'create trigger %I_log_activity after insert or update or delete on public.%I '
      'for each row execute function public.log_admin_activity()',
      tbl, tbl
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- SEED — website settings that mirror today's code exactly (no visual change
-- when the public site later reads them). The client never writes secrets here.
-- ----------------------------------------------------------------------------
insert into public.site_settings
  (setting_key, setting_value, value_type, publicly_visible)
values
  ('site_name', 'Nostalgia Radio', 'text', true),
  ('site_description', 'Old roads, local radios and the songs that never really left.', 'text', true),
  ('donation_url', '#', 'text', true),
  ('maintenance_mode', 'false', 'boolean', true),
  ('seo_title', 'Nostalgia Radio — Classic Hindi & Regional Radio', 'text', false),
  ('seo_description', 'Listen to curated nostalgic music from across India.', 'text', false)
on conflict (setting_key) do nothing;
