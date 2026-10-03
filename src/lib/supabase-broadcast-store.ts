import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isBroadcastTrack,
  isBroadcastUpcomingItem,
} from './broadcast';
import type { BroadcastSnapshot } from './broadcast';
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from './supabase-env';

/**
 * The Supabase implementation of the broadcast store — PostgREST queries and
 * realtime only, no business rules (they live in the `broadcast_*` definer
 * functions, migration 9). What it deliberately does NOT do:
 *
 *  - never writes `broadcasts` directly — writes go through the CAS functions;
 *  - never invents a duration, a title or a clock reading;
 *  - never references a service-role key — everything runs as `anon` under RLS.
 */

export interface BroadcastStore {
  /** Fresh state + server clock + votes-ordered queue for one channel. */
  fetchSnapshot(category: string): Promise<BroadcastSnapshot>;
  /** Realtime convergence: fires when the channel row changes. */
  subscribe(category: string, onChange: () => void): () => void;
  /** Compare-and-swap end-of-track advance. Rejects when the race is lost. */
  advance(category: string, expectedStartedAt: string): Promise<void>;
  /** Fill in a provider-reported length (server clamps to 10–900s). */
  reportDuration(category: string, expectedStartedAt: string, seconds: number): Promise<void>;
}

interface PgError {
  code?: string | null;
  message?: string | null;
}

const pgMessage = (error: PgError | null | undefined): string =>
  error?.message ?? 'broadcast unavailable';

/** Parse the `broadcast_state` payload — untrusted rows never pass as-is. */
export const parseSnapshot = (data: unknown): BroadcastSnapshot => {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const broadcast = isBroadcastTrack(body.broadcast) ? body.broadcast : null;
  const rawUpcoming = Array.isArray(body.upcoming) ? body.upcoming : [];
  return {
    broadcast,
    server_now:
      typeof body.server_now === 'string' && Number.isFinite(Date.parse(body.server_now))
        ? body.server_now
        : new Date().toISOString(),
    upcoming: rawUpcoming.filter(isBroadcastUpcomingItem),
  };
};

export function createSupabaseBroadcastStore(client: SupabaseClient): BroadcastStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(pgMessage(error));
    return data;
  };

  return {
    async fetchSnapshot(category) {
      return parseSnapshot(await call('broadcast_state', { p_category: category }));
    },

    subscribe(category, onChange) {
      if (typeof window === 'undefined') return () => {};
      try {
        const channel = client.channel(`nostalgia-broadcast-${category}`, {
          config: { broadcast: { self: false } },
        });
        channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'broadcasts', filter: `category_slug=eq.${category}` },
            () => onChange(),
          )
          .subscribe((status) => {
            // A blocked channel is not fatal: the 15s poll keeps converging;
            // realtime only makes the boundary feel instant.
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return;
          });
        return () => {
          void client.removeChannel(channel);
        };
      } catch {
        return () => {}; // realtime unavailable → polling alone
      }
    },

    async advance(category, expectedStartedAt) {
      await call('advance_broadcast', {
        p_category: category,
        p_expected_started_at: expectedStartedAt,
      });
    },

    async reportDuration(category, expectedStartedAt, seconds) {
      await call('report_broadcast_duration', {
        p_category: category,
        p_expected_started_at: expectedStartedAt,
        p_duration_sec: seconds,
      });
    },
  };
}

/**
 * The browser wiring: publishable values only, no session persistence, lazily
 * constructed so SSR and unconfigured builds never touch it. Loaded through a
 * dynamic import so the Supabase client stays out of the public bundle.
 */
export function createBrowserBroadcastStore(): BroadcastStore {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)');
  }
  const client = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 4 } },
  });
  return createSupabaseBroadcastStore(client);
}
