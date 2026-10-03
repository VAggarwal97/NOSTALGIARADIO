-- Nostalgia Radio — 000009: BROADCASTS (the live-broadcast clock).
--
-- One shared channel per category: what the radio is airing right now, since
-- when, and how long it runs. The client computes `elapsed = server_now -
-- started_at` and seeks on join, so every listener — home, suggest-music,
-- brand-new tab — lands on the same position of the same song. Audio bytes
-- never enter this table: `source_url` is a pointer the browser plays from
-- its own source (local file / provider embed), per the architecture rule
-- "Supabase carries state, never audio".
--
-- Advancement is compare-and-swap: a caller must present the `started_at` it
-- observed, so exactly one racer wins an end-of-track advance and everyone
-- else converges on the winner's row through realtime (or the next poll).
-- The state function also advances lazily when a duration known track has
-- run out with nobody watching, so a channel never goes stale.
--
-- Community-first scheduling (Mode B): the highest-voted approved request
-- that has never aired goes next; only when the queue is empty does the
-- station programme rotate. Submitting or voting never puts a song on air —
-- votes and the boundary do.
--
-- Security follows the house pattern (000005/000006/000007): RLS with a
-- public read only, writes exclusively through `security definer` functions
-- with a pinned search_path, execute revoked from PUBLIC and granted to
-- anon + authenticated.

create table if not exists public.broadcasts (
  category_slug text primary key references public.categories(slug) on delete cascade,
  -- Pointer + metadata only: station slug · songs.id · suggestions.id.
  track_kind    text not null check (track_kind in ('station', 'song', 'suggestion')),
  track_key     text not null check (length(track_key) between 1 and 120),
  station_slug  text check (station_slug is null or length(station_slug) between 1 and 120),
  title         text not null check (length(btrim(title)) between 1 and 300),
  subtitle      text check (subtitle is null or length(subtitle) <= 300),
  artwork_url   text check (artwork_url is null or
                  (length(artwork_url) <= 500 and
                   (artwork_url like '/%' or artwork_url like 'https://%'))),
  source_type   text not null check (source_type in ('direct-audio', 'youtube', 'spotify')),
  source_url    text check (source_url is null or
                  (length(source_url) between 1 and 1000 and
                   (source_url like '/%' or source_url like 'https://%'))),
  -- Null for provider tracks whose length is only known once a player loads
  -- it (report_broadcast_duration fills it); null duration = no time-based
  -- advance, the engine's ended event drives the boundary instead.
  duration_sec  integer check (duration_sec is null or duration_sec > 0),
  -- The broadcast clock. elapsed = server_now - started_at, everywhere.
  started_at    timestamptz not null default now(),
  status        text not null default 'live' check (status in ('live', 'paused', 'offline')),
  updated_at    timestamptz not null default now()
);

comment on table public.broadcasts is
  'One row per category channel: live track pointers + the shared started_at clock. Pointers only — audio streams from source_url in the browser, never from Supabase.';
comment on column public.broadcasts.started_at is
  'Server clock reading when the current track started. Every client derives its position from this — never store per-user playback time.';

alter table public.broadcasts enable row level security;

drop policy if exists broadcasts_open_read on public.broadcasts;
create policy broadcasts_open_read on public.broadcasts
  for select to anon, authenticated using (true);

-- Supabase's default privileges hand anon every new table; the only public
-- path here is SELECT. Writes live exclusively in the definer functions.
revoke insert, update, delete, truncate on public.broadcasts from anon, authenticated;
grant select on public.broadcasts to anon, authenticated;

-- Realtime: listeners converge on state changes (TRACK_CHANGED) without
-- polling; the client poll remains the fallback when the channel is down.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'broadcasts'
  ) then
    execute 'alter publication supabase_realtime add table public.broadcasts';
  end if;
exception
  when duplicate_object then null; -- raced with a concurrent applier
end $$;

-- ----------------------------------------------------------------------------
-- Does this suggestion belong to this channel? Stationless requests are the
-- mix channel's; anything else airs on its station's category channel.
-- ----------------------------------------------------------------------------
create or replace function public.broadcast_suggestion_matches(p_category text, p_station_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_station_id is null then p_category = 'mix'
    else exists (
      select 1 from public.stations st
       where st.id = p_station_id
         and st.category_id = (select c.id from public.categories c where c.slug = p_category)
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- The programme: community queue first (votes decide), station rotation after.
-- Returns null only when the category has no playable station at all.
-- ----------------------------------------------------------------------------
create or replace function public.broadcast_next_track(p_category text, p_current_station text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_suggestion jsonb;
  v_station    record;
  v_song       record;
  v_order      integer;
begin
  -- 1. The radio belongs to the community: highest votes, oldest first, and
  --    never a song that already aired (played_at is permanent).
  select jsonb_build_object(
           'kind', 'suggestion',
           'key', s.id::text,
           'station_slug', st.slug,
           'title', s.title,
           'subtitle', s.artist,
           'artwork', s.artwork_url,
           'source_type', s.provider,
           'source_url', s.song_url,
           'duration', null
         )
    into v_suggestion
    from public.suggestions s
    left join public.suggestion_vote_counts v on v.suggestion_id = s.id
    left join public.stations st on st.id = s.station_id
   where s.status = 'approved'
     and s.played_at is null
     and public.broadcast_suggestion_matches(p_category, s.station_id)
   order by coalesce(v.votes, 0) desc, s.created_at asc
   limit 1;

  if v_suggestion is not null then
    return v_suggestion;
  end if;

  -- 2. Station programme: rotate through the category's playable stations.
  select coalesce(sort_order, 0) into v_order
    from public.stations where slug = p_current_station;

  if not found then
    v_order := -1;
  end if;

  select s.id as station_id, s.slug, s.title, s.audio_url, s.artwork_url
    into v_station
    from public.stations s
   where s.category_id = (select c.id from public.categories c where c.slug = p_category)
     and s.active = true
     and s.action = 'play'
     and coalesce(s.sort_order, 0) > v_order
   order by s.sort_order
   limit 1;

  if not found then
    select s.id as station_id, s.slug, s.title, s.audio_url, s.artwork_url
      into v_station
      from public.stations s
     where s.category_id = (select c.id from public.categories c where c.slug = p_category)
       and s.active = true
       and s.action = 'play'
     order by s.sort_order
     limit 1;
  end if;

  if not found or v_station.station_id is null then
    return null;
  end if;

  -- The station's programme songs carry real durations; fall back to the
  -- station's own source when the library has nothing active for it.
  select id, title, duration_sec, audio_url, artwork_url
    into v_song
    from public.songs
   where station_id = v_station.station_id
     and active = true
   order by sort_order
   limit 1;

  if found and v_song.audio_url is not null then
    return jsonb_build_object(
      'kind', 'song',
      'key', v_song.id::text,
      'station_slug', v_station.slug,
      'title', v_song.title,
      'subtitle', v_station.title,
      'artwork', coalesce(v_song.artwork_url, v_station.artwork_url),
      'source_type', 'direct-audio',
      'source_url', v_song.audio_url,
      'duration', v_song.duration_sec
    );
  end if;

  return jsonb_build_object(
    'kind', 'station',
    'key', v_station.slug,
    'station_slug', v_station.slug,
    'title', v_station.title,
    'subtitle', null,
    'artwork', v_station.artwork_url,
    'source_type', 'direct-audio',
    'source_url', v_station.audio_url,
    'duration', null
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Read the channel: state + server clock + the queue ahead. First caller in
-- initialises the channel from its programme; a duration-known track that ran
-- out advances here, so even an empty room keeps time honestly.
-- ----------------------------------------------------------------------------
create or replace function public.broadcast_state(p_category text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now       timestamptz := now();
  v_row       public.broadcasts;
  v_next      jsonb;
  v_upcoming  jsonb;
  v_broadcast jsonb;
begin
  if p_category is null
     or not exists (select 1 from public.categories c where c.slug = p_category) then
    return jsonb_build_object('broadcast', null, 'server_now', v_now, 'upcoming', '[]'::jsonb);
  end if;

  select * into v_row from public.broadcasts where category_slug = p_category;

  if not found then
    v_next := public.broadcast_next_track(p_category, null);
    if v_next is null then
      return jsonb_build_object('broadcast', null, 'server_now', v_now, 'upcoming', '[]'::jsonb);
    end if;
    insert into public.broadcasts
      (category_slug, track_kind, track_key, station_slug, title, subtitle,
       artwork_url, source_type, source_url, duration_sec, started_at, status, updated_at)
    values
      (p_category, v_next->>'kind', v_next->>'key', v_next->>'station_slug',
       v_next->>'title', v_next->>'subtitle', v_next->>'artwork',
       v_next->>'source_type', v_next->>'source_url',
       nullif(v_next->>'duration', '')::integer, v_now, 'live', v_now)
    on conflict (category_slug) do nothing
    returning * into v_row;

    if v_row.category_slug is null then
      select * into v_row from public.broadcasts where category_slug = p_category;
    end if;
  elsif v_row.status = 'live'
        and v_row.duration_sec is not null
        and v_row.started_at + make_interval(secs => v_row.duration_sec) <= v_now then
    -- Stale channel: nobody was left to report the end. Advance in place.
    -- Lock order deliberately mirrors advance_broadcast — channel row first,
    -- then suggestions — so the two paths can never form an ABBA deadlock.
    select * into v_row
      from public.broadcasts
     where category_slug = p_category
       and started_at = v_row.started_at
     for update;

    if not found then
      -- A live listener advanced it while we were reading: theirs is fresher.
      select * into v_row from public.broadcasts where category_slug = p_category;
    else
      if v_row.track_kind = 'suggestion' then
        update public.suggestions
           set status = 'played', played_at = v_now, updated_at = v_now
         where id::text = v_row.track_key and status = 'approved' and played_at is null;
      end if;
      v_next := public.broadcast_next_track(p_category, v_row.station_slug);
      if v_next is not null then
        update public.broadcasts
           set track_kind = v_next->>'kind',
               track_key = v_next->>'key',
               station_slug = v_next->>'station_slug',
               title = v_next->>'title',
               subtitle = v_next->>'subtitle',
               artwork_url = v_next->>'artwork',
               source_type = v_next->>'source_type',
               source_url = v_next->>'source_url',
               duration_sec = nullif(v_next->>'duration', '')::integer,
               started_at = v_now,
               updated_at = v_now
         where category_slug = p_category and started_at = v_row.started_at
         returning * into v_row;
        if v_row.category_slug is null then
          select * into v_row from public.broadcasts where category_slug = p_category;
        end if;
      end if;
    end if;
  end if;

  if v_row.category_slug is null then
    -- Row vanished mid-flight (category deleted): honest empty state rather
    -- than an all-null object the client would have to second-guess.
    return jsonb_build_object('broadcast', null, 'server_now', v_now, 'upcoming', '[]'::jsonb);
  end if;

  -- Up next, exactly what the queue popup shows: community requests by votes
  -- (excluding what is on air), then nothing else — the station programme is
  -- the floor beneath the queue, visible in the current track itself.
  select coalesce(jsonb_agg(entry order by rn), '[]'::jsonb)
    into v_upcoming
    from (
      select row_number() over (order by coalesce(v.votes, 0) desc, s.created_at asc) as rn,
             jsonb_build_object(
               'kind', 'suggestion',
               'key', s.id::text,
               'title', s.title,
               'subtitle', s.artist,
               'artwork', s.artwork_url,
               'source_type', s.provider,
               'votes', coalesce(v.votes, 0)
             ) as entry
        from public.suggestions s
        left join public.suggestion_vote_counts v on v.suggestion_id = s.id
       where s.status = 'approved'
         and s.played_at is null
         and public.broadcast_suggestion_matches(p_category, s.station_id)
         and not (v_row.track_kind = 'suggestion' and s.id::text = v_row.track_key)
       order by coalesce(v.votes, 0) desc, s.created_at asc
       limit 6
    ) ranked;

  -- A community request on air carries its live vote count, so the pill's
  -- "N requested" is a database fact — never a guess, never a stored total.
  if v_row.track_kind = 'suggestion' then
    v_broadcast := to_jsonb(v_row) || jsonb_build_object(
      'votes',
      coalesce(
        (select v.votes from public.suggestion_vote_counts v
          where v.suggestion_id::text = v_row.track_key),
        0
      )
    );
  else
    v_broadcast := to_jsonb(v_row);
  end if;

  return jsonb_build_object(
    'broadcast', v_broadcast,
    'server_now', v_now,
    'upcoming', v_upcoming
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- End-of-track advance: compare-and-swap on the caller's observed clock.
-- Exactly one racer wins; losers receive the winner's state unchanged.
-- Airing-out suggestion is recorded here, at the boundary — never at submit,
-- never at vote, never on a personal preview play.
-- ----------------------------------------------------------------------------
create or replace function public.advance_broadcast(p_category text, p_expected_started_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  public.broadcasts;
  v_next jsonb;
  v_now  timestamptz := now();
begin
  if p_category is null or p_expected_started_at is null then
    select * into v_row from public.broadcasts where category_slug = p_category;
    return jsonb_build_object(
      'broadcast', case when v_row.category_slug is null then null else to_jsonb(v_row) end,
      'server_now', v_now);
  end if;

  select * into v_row
    from public.broadcasts
   where category_slug = p_category
     and started_at = p_expected_started_at
     for update;

  if not found then
    -- Someone else advanced first (or the channel does not exist yet):
    -- hand back the fresh state instead of double-skipping.
    select * into v_row from public.broadcasts where category_slug = p_category;
    return jsonb_build_object(
      'broadcast', case when v_row.category_slug is null then null else to_jsonb(v_row) end,
      'server_now', v_now);
  end if;

  if v_row.track_kind = 'suggestion' then
    update public.suggestions
       set status = 'played', played_at = v_now, updated_at = v_now
     where id::text = v_row.track_key and status = 'approved' and played_at is null;
  end if;

  v_next := public.broadcast_next_track(p_category, v_row.station_slug);
  if v_next is null then
    return jsonb_build_object('broadcast', to_jsonb(v_row), 'server_now', v_now, 'unchanged', true);
  end if;

  update public.broadcasts
     set track_kind = v_next->>'kind',
         track_key = v_next->>'key',
         station_slug = v_next->>'station_slug',
         title = v_next->>'title',
         subtitle = v_next->>'subtitle',
         artwork_url = v_next->>'artwork',
         source_type = v_next->>'source_type',
         source_url = v_next->>'source_url',
         duration_sec = nullif(v_next->>'duration', '')::integer,
         started_at = v_now,
         updated_at = v_now
   where category_slug = p_category
   returning * into v_row;

  return jsonb_build_object('broadcast', to_jsonb(v_row), 'server_now', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- The first player to know a provider track's real length records it — fill
-- only, clock-guarded, range-clamped (10s..15min) so a bogus number can never
-- break the shared timeline. Direct-audio lengths ship with the catalogue.
-- ----------------------------------------------------------------------------
create or replace function public.report_broadcast_duration(
  p_category text,
  p_expected_started_at timestamptz,
  p_duration_sec integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.broadcasts;
  v_now timestamptz := now();
begin
  select * into v_row from public.broadcasts where category_slug = p_category;
  if not found then
    return jsonb_build_object('broadcast', null, 'server_now', v_now);
  end if;

  if p_duration_sec is null or p_duration_sec < 10 or p_duration_sec > 900 then
    -- Out of range: report what is actually on air, change nothing.
    return jsonb_build_object('broadcast', to_jsonb(v_row), 'server_now', v_now);
  end if;

  update public.broadcasts
     set duration_sec = p_duration_sec,
         updated_at = v_now
   where category_slug = p_category
     and started_at = p_expected_started_at
     and duration_sec is null
     and track_kind = 'suggestion'
   returning * into v_row;

  if not found then
    -- CAS missed or already filled: another listener won the race — the
    -- fresh row is just as true (and the fill is idempotent by design).
    select * into v_row from public.broadcasts where category_slug = p_category;
    if not found then
      return jsonb_build_object('broadcast', null, 'server_now', v_now);
    end if;
  end if;

  return jsonb_build_object('broadcast', to_jsonb(v_row), 'server_now', v_now);
end;
$$;

-- Execute is PUBLIC by default and Supabase's default privileges hand it to
-- anon directly — revoke both, then grant exactly the three public entry
-- points. The two helpers stay callable only by the definer functions above
-- (their owner keeps its implicit rights; anon can no longer reach them).
revoke execute on function public.broadcast_state(text) from public, anon, authenticated;
revoke execute on function public.advance_broadcast(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.report_broadcast_duration(text, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.broadcast_next_track(text, text) from public, anon, authenticated;
revoke execute on function public.broadcast_suggestion_matches(text, uuid) from public, anon, authenticated;

grant execute on function public.broadcast_state(text) to anon, authenticated;
grant execute on function public.advance_broadcast(text, timestamptz) to anon, authenticated;
grant execute on function public.report_broadcast_duration(text, timestamptz, integer) to anon, authenticated;
