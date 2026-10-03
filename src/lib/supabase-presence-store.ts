import { createClient } from '@supabase/supabase-js';

import type { PresenceApi } from './presence-api';
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from './supabase-env';

/**
 * Global live sessions over Supabase Realtime presence — every connected
 * visitor counts, not only this browser's tabs. Pure decoration: it reads no
 * rows, writes nothing, and references no key beyond the public publishable
 * one. The local BroadcastChannel tally (presence-api.ts) remains the
 * fallback whenever this cannot be created or never answers.
 */
export function createBrowserPresence(): PresenceApi | null {
  if (!isSupabaseConfigured()) return null;

  const client = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const listeners = new Set<(sessions: number) => void>();
  let reported: number | null = null;
  let channel: ReturnType<typeof client.channel> | null = null;

  const emit = (sessions: number): void => {
    if (sessions === reported) return;
    reported = sessions;
    for (const listener of listeners) listener(sessions);
  };

  const start = (): void => {
    if (channel) return;
    const selfKey = `s-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const next = client.channel('presence:listeners', {
      config: { presence: { key: selfKey } },
    });
    channel = next;
    next
      .on('presence', { event: 'sync' }, () => {
        // The server's view of who is present — never counted client-side.
        const state = next.presenceState();
        emit(Object.keys(state).length);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          next.track({ online_at: new Date().toISOString() });
        }
      });
  };

  const stop = (): void => {
    if (!channel) return;
    const current = channel;
    channel = null;
    reported = null;
    void client.removeChannel(current);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      if (reported !== null) listener(reported);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    close() {
      listeners.clear();
      stop();
    },
  };
}
