import type { SourceDecision } from './sourcePolicy';
import { isSafeUrl } from './urlSafety';

/**
 * The live-broadcast contract — pure types, clock math and source mapping.
 * Nothing here touches Supabase or the DOM: every function is unit-testable
 * in isolation, and the browser never sees a row shape it did not validate.
 *
 * The whole model rests on one number: `elapsed = (server_now - started_at)
 * measured at fetch, plus the local time that passed since`. Every listener —
 * home, suggest-music, brand-new tab — derives the same position from the
 * shared clock, so joining late still lands on the same second of the same
 * song. Audio bytes never travel through this layer; sources stream from
 * wherever they already live (local file, YouTube, Spotify).
 */

export type BroadcastScope = 'channel' | 'local';
export type BroadcastTrackKind = 'station' | 'song' | 'suggestion';
export type BroadcastSourceType = 'direct-audio' | 'youtube' | 'spotify';

/** One row of `public.broadcasts` as the client receives it. */
export interface BroadcastTrack {
  category_slug: string;
  track_kind: BroadcastTrackKind;
  track_key: string;
  station_slug: string | null;
  title: string;
  subtitle: string | null;
  artwork_url: string | null;
  source_type: BroadcastSourceType;
  source_url: string | null;
  duration_sec: number | null;
  started_at: string;
  status: 'live' | 'paused' | 'offline';
  /** Present only while a community request is on air (server-computed). */
  votes?: number;
}

/** One entry of the votes-ordered queue shown in the popup and the strip. */
export interface BroadcastUpcomingItem {
  kind: BroadcastTrackKind;
  key: string;
  title: string;
  subtitle?: string | null;
  artwork?: string | null;
  source_type?: BroadcastSourceType;
  votes?: number;
}

export interface BroadcastSnapshot {
  broadcast: BroadcastTrack | null;
  server_now: string;
  upcoming: BroadcastUpcomingItem[];
}

/** Server clock reading paired with the local reading taken on arrival. */
export interface BroadcastClock {
  serverNowMs: number;
  fetchedAtMs: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const isKind = (value: unknown): value is BroadcastTrackKind =>
  value === 'station' || value === 'song' || value === 'suggestion';

const isSourceType = (value: unknown): value is BroadcastSourceType =>
  value === 'direct-audio' || value === 'youtube' || value === 'spotify';

/** Validate a server row before any of it reaches state or an engine. */
export function isBroadcastTrack(value: unknown): value is BroadcastTrack {
  const row = asRecord(value);
  if (!row) return false;
  return (
    typeof row.category_slug === 'string' &&
    isKind(row.track_kind) &&
    typeof row.track_key === 'string' &&
    typeof row.title === 'string' &&
    typeof row.started_at === 'string' &&
    Number.isFinite(Date.parse(row.started_at)) &&
    isSourceType(row.source_type) &&
    (row.source_url === null || typeof row.source_url === 'string') &&
    (row.duration_sec === null ||
      (typeof row.duration_sec === 'number' && row.duration_sec > 0)) &&
    (row.status === 'live' || row.status === 'paused' || row.status === 'offline')
  );
}

export function isBroadcastUpcomingItem(value: unknown): value is BroadcastUpcomingItem {
  const row = asRecord(value);
  if (!row) return false;
  return isKind(row.kind) && typeof row.key === 'string' && typeof row.title === 'string';
}

/** Pair the server clock with the local reading — skew cancels out from here. */
export function clockFor(snapshot: BroadcastSnapshot, nowMs: number = Date.now()): BroadcastClock {
  const serverNowMs = Date.parse(snapshot.server_now);
  return {
    serverNowMs: Number.isFinite(serverNowMs) ? serverNowMs : nowMs,
    fetchedAtMs: nowMs,
  };
}

/**
 * Seconds the shared broadcast has been on the current track, as of `nowMs`.
 * The fetch-time remainder plus the local time that passed since — never
 * stored per user, never faked by the engine.
 */
export function broadcastElapsedSec(
  track: BroadcastTrack,
  clock: BroadcastClock,
  nowMs: number,
): number {
  const startedMs = Date.parse(track.started_at);
  if (!Number.isFinite(startedMs)) return 0;
  const atFetch = clock.serverNowMs - startedMs;
  return Math.max(0, (atFetch + (nowMs - clock.fetchedAtMs)) / 1000);
}

/** True when a duration-known track has run out — the advance tick's guard. */
export function broadcastPastEnd(
  track: BroadcastTrack,
  clock: BroadcastClock,
  nowMs: number,
): boolean {
  return track.duration_sec !== null && broadcastElapsedSec(track, clock, nowMs) >= track.duration_sec;
}

/** Identity of the song that is on air — a new signature means a transition. */
export const trackSignature = (track: BroadcastTrack): string =>
  `${track.track_kind}:${track.track_key}`;

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'music.youtube.com']);
const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST_ID = /^[A-Za-z0-9_-]{6,}$/;

/**
 * Map a provider URL to an official embed — the same validation the request
 * path uses, so a hand-edited or hostile row can never reach an engine.
 * Anything unrecognised returns null: the caller advances honestly instead.
 */
export function embedDecisionForUrl(
  provider: 'youtube' | 'spotify',
  url: string,
): Extract<SourceDecision, { kind: 'embed' }> | null {
  if (!url || !isSafeUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();

  if (provider === 'youtube') {
    if (!YOUTUBE_HOSTS.has(host)) return null;
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id && YT_VIDEO_ID.test(id)
        ? { kind: 'embed', source: { provider, playlistId: id, entity: 'video', url } }
        : null;
    }
    if (parsed.pathname === '/playlist') {
      const id = parsed.searchParams.get('list');
      return id && YT_LIST_ID.test(id)
        ? { kind: 'embed', source: { provider, playlistId: id, entity: 'playlist', url } }
        : null;
    }
    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.slice('/shorts/'.length);
      return id && YT_VIDEO_ID.test(id)
        ? { kind: 'embed', source: { provider, playlistId: id, entity: 'video', url } }
        : null;
    }
    return null;
  }

  if (host !== 'open.spotify.com') return null;
  const track = parsed.pathname.match(/^\/track\/([A-Za-z0-9]{22})\/?$/);
  if (track?.[1]) return { kind: 'embed', source: { provider, playlistId: track[1], entity: 'track', url } };
  const list = parsed.pathname.match(/^\/playlist\/([A-Za-z0-9]{10,})\/?$/);
  if (list?.[1]) return { kind: 'embed', source: { provider, playlistId: list[1], entity: 'playlist', url } };
  return null;
}

/**
 * What the engine loads for an on-air channel track: local file or official
 * provider embed, straight from the server's pointers. null = honest refusal
 * (no source, failed validation) — the caller then skips to the next track.
 */
export type BroadcastDecision = Extract<SourceDecision, { kind: 'play' } | { kind: 'embed' }>;

export function decisionForBroadcastTrack(track: BroadcastTrack): BroadcastDecision | null {
  if (track.source_type === 'direct-audio') {
    if (!track.source_url || !isSafeUrl(track.source_url)) return null;
    return { kind: 'play', audioUrl: track.source_url };
  }
  if (!track.source_url) return null;
  return embedDecisionForUrl(track.source_type, track.source_url);
}

/**
 * A duration a client may report: the server accepts 10–900 seconds only.
 * Outside that window the client reports nothing — the engine's own "ended"
 * still drives the boundary, so nothing here can stall or fabricate a length.
 */
export function reportableDuration(seconds: number): number | null {
  if (!Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  return whole >= 10 && whole <= 900 ? whole : null;
}
