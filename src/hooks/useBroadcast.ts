import { useCallback, useEffect, useRef, useState } from 'react';

import {
  broadcastElapsedSec,
  broadcastPastEnd,
  clockFor,
  reportableDuration,
} from '../lib/broadcast';
import type {
  BroadcastClock,
  BroadcastSnapshot,
  BroadcastUpcomingItem,
  BroadcastTrack,
} from '../lib/broadcast';
import { isSupabaseConfigured } from '../lib/supabase-env';
import type { BroadcastStore } from '../lib/supabase-broadcast-store';
import type { CategoryId } from '../types/station';

/**
 * One shared broadcast clock per category. The hook:
 *
 *  - fetches `broadcast_state` on mount and category change (join-seek data),
 *  - re-fetches on realtime `TRACK_CHANGED` and on a 15s poll fallback,
 *  - ticks once per second (elapsed for the UI, boundary check for advance),
 *  - advances the channel by CAS the moment a duration-known track runs out,
 *  - fills in a provider-reported length once, per started_at.
 *
 * It plays nothing and touches no engine — App owns the single global player;
 * this hook owns only the truth about what is on air and since when.
 */

let storePromise: Promise<BroadcastStore | null> | null = null;

/** Dynamic import: the Supabase chunk stays out of the public bundle. */
const loadStore = (): Promise<BroadcastStore | null> => {
  if (typeof window === 'undefined' || !isSupabaseConfigured()) return Promise.resolve(null);
  storePromise ??= import('../lib/supabase-broadcast-store')
    .then((module) => module.createBrowserBroadcastStore())
    .catch(() => null);
  return storePromise;
};

const POLL_MS = 15_000;
const TICK_MS = 1_000;

export interface BroadcastApi {
  /** What is on air right now — null before the first fetch or when empty. */
  track: BroadcastTrack | null;
  /** Votes-ordered queue ahead of the current track (max 6). */
  upcoming: BroadcastUpcomingItem[];
  /** Seconds on the shared clock — advances with the 1s tick. */
  elapsed: number;
  /** First snapshot for this category has arrived (success or failure). */
  joined: boolean;
  /** The channel cannot be reached (unconfigured, offline, endpoint down). */
  unavailable: boolean;
  /** Refetch now (realtime missed us, or a boundary just resolved). */
  refetch: () => void;
  /** CAS end-of-track advance; resolves false when unreachable. */
  advance: () => Promise<boolean>;
  /** Report a real, provider-known length for the on-air suggestion. */
  reportDuration: (seconds: number) => void;
}

export function useBroadcast(category: CategoryId): BroadcastApi {
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [clock, setClock] = useState<BroadcastClock | null>(null);
  const [joined, setJoined] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [, setNowMs] = useState(() => Date.now());

  const snapshotRef = useRef<BroadcastSnapshot | null>(null);
  const clockRef = useRef<BroadcastClock | null>(null);
  const storeRef = useRef<BroadcastStore | null>(null);
  const fetchingRef = useRef(false);
  const advancingRef = useRef(false);
  const reportedRef = useRef<string | null>(null);

  snapshotRef.current = snapshot;
  clockRef.current = clock;
  // Latest category for callbacks that must not re-subscribe every render.
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const refetch = useCallback(() => {
    const store = storeRef.current;
    const categoryNow = categoryRef.current;
    if (!store || !categoryNow || fetchingRef.current) return;
    fetchingRef.current = true;
    store
      .fetchSnapshot(categoryNow)
      .then((next) => {
        setSnapshot(next);
        setClock(clockFor(next));
        setJoined(true);
        setUnavailable(false);
      })
      .catch(() => {
        setJoined(true); // honest: we tried and know nothing yet
        setUnavailable(true);
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, []);

  const advance = useCallback(async (): Promise<boolean> => {
    const store = storeRef.current;
    const track = snapshotRef.current?.broadcast;
    if (!store || !track || advancingRef.current) return false;
    advancingRef.current = true;
    try {
      await store.advance(track.category_slug, track.started_at);
      refetch(); // converge on the winner's row (and the queue behind it)
      return true;
    } catch {
      return false; // lost race or offline — the poll/realtime will converge
    } finally {
      advancingRef.current = false;
    }
  }, [refetch]);

  const reportDuration = useCallback(
    (seconds: number) => {
      const store = storeRef.current;
      const track = snapshotRef.current?.broadcast;
      if (!store || !track) return;
      if (track.track_kind !== 'suggestion' || track.duration_sec !== null) return;
      if (reportedRef.current === track.started_at) return; // once per clock round
      const whole = reportableDuration(seconds);
      if (whole === null) return;
      reportedRef.current = track.started_at;
      store
        .reportDuration(track.category_slug, track.started_at, whole)
        .then(() => refetch())
        .catch(() => {
          reportedRef.current = null; // honest retry on the next tick
        });
    },
    [refetch],
  );

  // Category switch: drop the old channel, load the new one, resubscribe.
  useEffect(() => {
    let cancelled = false;
    setJoined(false);
    setUnavailable(false);
    setSnapshot(null);
    setClock(null);
    snapshotRef.current = null;
    clockRef.current = null;
    reportedRef.current = null;

    let unsubscribe = (): void => {};
    void loadStore().then((store) => {
      if (cancelled) return;
      storeRef.current = store;
      if (!store) {
        setUnavailable(true);
        setJoined(true);
        return;
      }
      refetch();
      unsubscribe = store.subscribe(category, refetch);
    });

    const poll = window.setInterval(refetch, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      unsubscribe();
      storeRef.current = null;
    };
  }, [category, refetch]);

  // One honest second at a time: elapsed for the strip, boundary for advance.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
      const now = Date.now();
      const track = snapshotRef.current?.broadcast;
      const currentClock = clockRef.current;
      if (track && currentClock && broadcastPastEnd(track, currentClock, now)) {
        void advance();
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [advance]);

  const track = snapshot?.broadcast ?? null;
  const currentClock = clock;
  const elapsed =
    track && currentClock ? broadcastElapsedSec(track, currentClock, Date.now()) : 0;

  return {
    track,
    upcoming: snapshot?.upcoming ?? [],
    elapsed,
    joined,
    unavailable,
    refetch,
    advance,
    reportDuration,
  };
}
