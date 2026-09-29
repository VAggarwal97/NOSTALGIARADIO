import { randomId } from './id';

/**
 * Community suggestions ("suggest music") — API-shaped like the rest:
 * strict URL validation, duplicate detection and a per-session rate limit
 * run inside this module, so a real backend (e.g. Supabase) can replace the
 * local implementation without touching the UI. No keys live in this repo.
 *
 * Only links that are unmistakably songs are accepted: a YouTube video or a
 * Spotify track. Albums, playlists, channels and everything else are refused.
 */

export type SongProvider = 'youtube' | 'spotify';

export interface SongRef {
  provider: SongProvider;
  /** Provider-native ID — the identity used for duplicate detection. */
  id: string;
  /** Normalised share URL — what a future queue would store. */
  url: string;
}

export interface Suggestion {
  id: string;
  song: SongRef;
  /** Where it was suggested from, so suggestions keep their context. */
  stationId: string | null;
  createdAt: number;
}

export type SuggestFailure = 'invalid-url' | 'duplicate' | 'rate-limited';

export type SuggestResult =
  | { ok: true; suggestion: Suggestion }
  | { ok: false; reason: SuggestFailure };

export interface RequestApi {
  submit(input: { url: string; stationId: string | null }): Promise<SuggestResult>;
  /** Newest first — the read side a future board would render. */
  list(): Promise<Suggestion[]>;
}

/** YouTube video IDs are exactly 11 URL-safe characters. */
const YOUTUBE_ID = /^[\w-]{11}$/;
/** Spotify track IDs are 22 base62 characters (10 keeps some headroom). */
const SPOTIFY_ID = /^[A-Za-z0-9]{10,}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]);

const youtube = (id: string): SongRef => ({
  provider: 'youtube',
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
});

const spotify = (id: string): SongRef => ({
  provider: 'spotify',
  id,
  url: `https://open.spotify.com/track/${id}`,
});

/**
 * Parse a pasted link down to a single song, or null if it isn't one.
 * Accepts: youtube watch/shorts/youtu.be videos, open.spotify.com tracks
 * (including /embed/ and /intl-…/ forms). Rejects everything else.
 */
export function parseSongUrl(raw: string): SongRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return YOUTUBE_ID.test(id) ? youtube(id) : null;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return YOUTUBE_ID.test(id) ? youtube(id) : null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'shorts' && segments[1] && YOUTUBE_ID.test(segments[1])) {
      return youtube(segments[1]);
    }
    // Playlists, channels, handles, live … — songs only, not surfaces.
    return null;
  }

  if (host === 'open.spotify.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const trackAt = segments.indexOf('track');
    const id = trackAt >= 0 ? (segments[trackAt + 1] ?? '') : '';
    // /track/<id>, /embed/track/<id> and /intl-xx/track/<id> all qualify;
    // /album, /playlist, /artist … never contain a "track" segment.
    return SPOTIFY_ID.test(id) ? spotify(id) : null;
  }

  return null;
}

const RATE_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;

/** Session-scoped local queue: dedupe by provider ID, throttle submissions. */
export function createLocalRequestApi(now: () => number = () => Date.now()): RequestApi {
  const suggestions = new Map<string, Suggestion>();
  const submittedAt: number[] = [];

  return {
    async submit({ url, stationId }) {
      const song = parseSongUrl(url);
      if (!song) return { ok: false, reason: 'invalid-url' };

      const key = `${song.provider}:${song.id}`;
      if (suggestions.has(key)) return { ok: false, reason: 'duplicate' };

      const at = now();
      while (submittedAt.length > 0 && at - submittedAt[0] > RATE_WINDOW_MS) {
        submittedAt.shift();
      }
      if (submittedAt.length >= MAX_PER_WINDOW) return { ok: false, reason: 'rate-limited' };

      const suggestion: Suggestion = {
        id: randomId(),
        song,
        stationId,
        createdAt: at,
      };
      suggestions.set(key, suggestion);
      submittedAt.push(at);
      return { ok: true, suggestion };
    },
    async list() {
      return [...suggestions.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
  };
}

let shared: RequestApi | null = null;

/** App-wide suggestion queue for this session. */
export function getRequestApi(): RequestApi {
  if (!shared) shared = createLocalRequestApi();
  return shared;
}
