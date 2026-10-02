import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabasePublishableKey, supabaseUrl, isSupabaseConfigured } from './supabase-env';
import { WallQueryError } from './wall-store';
import type { NewSuggestion, WallRow, WallStore } from './wall-store';

/**
 * The Supabase implementation of `WallStore` — PostgREST queries only, no
 * business rules. What it deliberately does NOT do:
 *
 *  - never selects `visitor_token` (the column grant wouldn't return it, and
 *    the code never asks);
 *  - never writes `status` (the database default owns moderation);
 *  - never reads a stored vote count (counts come from the aggregate view /
 *    the `wall_board` function);
 *  - never references a service-role key — everything here runs as `anon`
 *    under RLS.
 *
 * Errors are re-thrown as `WallQueryError` carrying the database's own
 * code/message so the RequestApi adapter can map them to the wall's failure
 * vocabulary (README §6).
 */

/** Exactly the columns the public SELECT grant covers — no token, ever. */
const PUBLIC_COLUMNS =
  'id, song_url, provider, provider_id, title, artist, artwork_url, ' +
  'station_id, status, played_at, created_at, updated_at';

const fail = (code: string | null, message: string): never => {
  throw new WallQueryError(code, message);
};

interface PgError {
  code?: string | null;
  message?: string;
}

const throwPg = (error: PgError): never => fail(error.code ?? null, error.message ?? 'database error');

interface CountRow {
  suggestion_id: string;
  votes: number;
}

interface LikeCountRow {
  suggestion_id: string;
  likes: number;
}

/** Fill in the honest aggregates for rows that didn't come from `wall_board`. */
const withCounts = async (
  client: SupabaseClient,
  rows: Array<Omit<WallRow, 'votes' | 'likes' | 'last_voted_at'>>,
): Promise<WallRow[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [votesResult, likesResult] = await Promise.all([
    client.from('suggestion_vote_counts').select('suggestion_id, votes').in('suggestion_id', ids),
    client.from('song_like_counts').select('suggestion_id, likes').in('suggestion_id', ids),
  ]);
  if (votesResult.error) throwPg(votesResult.error);
  if (likesResult.error) throwPg(likesResult.error);
  const votes = new Map<string, number>(
    ((votesResult.data ?? []) as CountRow[]).map((row) => [row.suggestion_id, row.votes]),
  );
  const likes = new Map<string, number>(
    ((likesResult.data ?? []) as LikeCountRow[]).map((row) => [row.suggestion_id, row.likes]),
  );
  return rows.map((row) => ({
    ...row,
    votes: votes.get(row.id) ?? 0,
    likes: likes.get(row.id) ?? 0,
    last_voted_at: null, // only wall_board computes it (server-side ordering)
  }));
};

/** Like counts only — `wall_board` already carries votes and last_voted_at. */
const withLikes = async (
  client: SupabaseClient,
  rows: Array<Omit<WallRow, 'likes'>>,
): Promise<WallRow[]> => {
  if (rows.length === 0) return [];
  const { data, error } = await client
    .from('song_like_counts')
    .select('suggestion_id, likes')
    .in(
      'suggestion_id',
      rows.map((row) => row.id),
    );
  if (error) throwPg(error);
  const likes = new Map<string, number>(
    ((data ?? []) as LikeCountRow[]).map((row) => [row.suggestion_id, row.likes]),
  );
  return rows.map((row) => ({ ...row, likes: likes.get(row.id) ?? 0 }));
};

const isPubRow = (value: unknown): value is Omit<WallRow, 'votes' | 'likes' | 'last_voted_at'> => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.song_url === 'string' &&
    typeof row.provider === 'string' &&
    typeof row.provider_id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.created_at === 'string'
  );
};

/** The column is uuid; bundled station ids are text slugs ('truck-wala-radio'). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSupabaseWallStore(client: SupabaseClient): WallStore {
  /**
   * Station stamps on suggestions are resolved once per slug. The stamp is
   * optional metadata (nullable column, no policy requirement): an unknown
   * slug or a failed lookup inserts NULL instead of failing the submit —
   * a broken station lookup must never cost a listener their request.
   */
  const stationUuidCache = new Map<string, string | null>();
  const resolveStationUuid = async (value: string | null): Promise<string | null> => {
    if (!value) return null;
    if (UUID_PATTERN.test(value)) return value; // already a database id
    const cached = stationUuidCache.get(value);
    if (cached !== undefined) return cached;
    const { data, error } = await client
      .from('stations')
      .select('id')
      .eq('slug', value)
      .maybeSingle();
    if (error) return null; // transient — deliberately not cached
    const uuid = typeof data?.id === 'string' && data.id ? data.id : null;
    stationUuidCache.set(value, uuid);
    return uuid;
  };

  return {
    async board(tab, query, limit) {
      const { data, error } = await client.rpc('wall_board', {
        p_tab: tab,
        p_query: query,
        p_limit: limit,
      });
      if (error) throwPg(error);
      const payload: unknown = data;
      // wall_board already carries votes and last_voted_at; only likes join here.
      const rows = (Array.isArray(payload) ? payload : []) as Array<Omit<WallRow, 'likes'>>;
      return withLikes(client, rows);
    },

    async list(limit) {
      const { data, error } = await client
        .from('suggestions')
        .select(PUBLIC_COLUMNS)
        .in('status', ['approved', 'played'])
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throwPg(error);
      const payload: unknown = data;
      const rows = (Array.isArray(payload) ? payload : []).filter(isPubRow);
      return withCounts(client, rows);
    },

    async byId(id) {
      const { data, error } = await client
        .from('suggestions')
        .select(PUBLIC_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throwPg(error);
      const payload: unknown = data;
      if (!isPubRow(payload)) return null;
      return (await withCounts(client, [payload]))[0] ?? null;
    },

    async bySong(provider, providerId) {
      const { data, error } = await client
        .from('suggestions')
        .select(PUBLIC_COLUMNS)
        .eq('provider', provider)
        .eq('provider_id', providerId)
        .maybeSingle();
      if (error) throwPg(error);
      const payload: unknown = data;
      if (!isPubRow(payload)) return null;
      return (await withCounts(client, [payload]))[0] ?? null;
    },

    async insertSuggestion(row: NewSuggestion) {
      const station_id = await resolveStationUuid(row.station_id); // slug → uuid for the column
      const { data, error } = await client
        .from('suggestions')
        .insert({ ...row, station_id }) // no `status` — the column default decides, not the browser
        .select(PUBLIC_COLUMNS)
        .maybeSingle();
      if (error) throwPg(error);
      const payload: unknown = data;
      if (!isPubRow(payload)) {
        // Inserted but hidden (strict pre-moderation is restored): the row
        // exists, the wall just may not show it. Report honestly upstream.
        return fail(null, 'submitted request is not publicly visible');
      }
      return { ...payload, votes: 0, likes: 0, last_voted_at: null };
    },

    async insertVote(suggestionId, token) {
      const { error } = await client
        .from('votes')
        .insert({ suggestion_id: suggestionId, visitor_token: token });
      if (error) throwPg(error);
    },

    async insertLike(suggestionId, token) {
      const { error } = await client
        .from('song_likes')
        .insert({ suggestion_id: suggestionId, visitor_token: token });
      if (error) throwPg(error);
    },

    subscribeChanges(onChange) {
      if (typeof window === 'undefined') return () => {};
      let stop: (() => void) | null = null;
      try {
        const channel = client.channel('nostalgia-wall', {
          config: { broadcast: { self: false } },
        });
        channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'suggestions' },
            () => onChange(),
          )
          .subscribe((status) => {
            // A blocked/failed channel is not fatal: the adapter's poll keeps
            // the wall converging; realtime only makes it faster.
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return;
          });
        stop = () => {
          void client.removeChannel(channel);
        };
      } catch {
        stop = null; // realtime unavailable → polling alone
      }
      return stop ?? (() => {});
    },
  };
}

/**
 * The browser wiring: publishable values only, no session persistence (the
 * public site has no auth — /admin owns its own client), lazily constructed
 * so SSR and unconfigured builds never touch it.
 */
export function createBrowserWallStore(): WallStore {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)');
  }
  const client = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 4 } },
  });
  return createSupabaseWallStore(client);
}
