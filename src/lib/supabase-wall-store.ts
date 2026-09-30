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

/** Fill in the honest aggregate for rows that didn't come from `wall_board`. */
const withCounts = async (
  client: SupabaseClient,
  rows: Array<Omit<WallRow, 'votes' | 'last_voted_at'>>,
): Promise<WallRow[]> => {
  if (rows.length === 0) return [];
  const { data, error } = await client
    .from('suggestion_vote_counts')
    .select('suggestion_id, votes')
    .in(
      'suggestion_id',
      rows.map((row) => row.id),
    );
  if (error) throwPg(error);
  const counts = new Map<string, number>(
    ((data ?? []) as CountRow[]).map((row) => [row.suggestion_id, row.votes]),
  );
  return rows.map((row) => ({
    ...row,
    votes: counts.get(row.id) ?? 0,
    last_voted_at: null, // only wall_board computes it (server-side ordering)
  }));
};

const isPubRow = (value: unknown): value is Omit<WallRow, 'votes' | 'last_voted_at'> => {
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

export function createSupabaseWallStore(client: SupabaseClient): WallStore {
  return {
    async board(tab, query, limit) {
      const { data, error } = await client.rpc('wall_board', {
        p_tab: tab,
        p_query: query,
        p_limit: limit,
      });
      if (error) throwPg(error);
      const payload: unknown = data;
      return (Array.isArray(payload) ? payload : []) as WallRow[];
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
      const { data, error } = await client
        .from('suggestions')
        .insert(row) // no `status` — the column default decides, not the browser
        .select(PUBLIC_COLUMNS)
        .maybeSingle();
      if (error) throwPg(error);
      const payload: unknown = data;
      if (!isPubRow(payload)) {
        // Inserted but hidden (strict pre-moderation is restored): the row
        // exists, the wall just may not show it. Report honestly upstream.
        return fail(null, 'submitted request is not publicly visible');
      }
      return { ...payload, votes: 0, last_voted_at: null };
    },

    async insertVote(suggestionId, token) {
      const { error } = await client
        .from('votes')
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
