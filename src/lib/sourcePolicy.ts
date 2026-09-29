import type { Station } from '../types/station';
import { classifyUrl, isSafeUrl, openExternally } from './urlSafety';

/** A validated official-playlist source the app can drive through its embed. */
export interface EmbedSource {
  provider: 'youtube' | 'spotify';
  /** Provider-native playlist ID extracted from `playlistUrl`. */
  playlistId: string;
  /** The validated playlist page URL — kept as the honest source link. */
  url: string;
}

export type SourceDecision =
  | { kind: 'play'; audioUrl: string }
  | { kind: 'embed'; source: EmbedSource }
  | { kind: 'open'; url: string }
  | { kind: 'check'; url: string }
  | { kind: 'blocked'; reason: string };

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'music.youtube.com']);
const PLAYLIST_ID = /^[A-Za-z0-9_-]{6,}$/;
const PLACEHOLDER_ID = /your|placeholder|xxxx|dummy/i;
const SPOTIFY_PLAYLIST_PATH = /^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{10,})\/?$/;

/**
 * Parse + validate a station's provider playlist configuration.
 * Returns null unless BOTH `provider` and `playlistUrl` are present and the
 * URL is a playlist page on that exact provider — watch URLs, tracks, albums,
 * channels and unsafe hosts are all rejected here rather than downstream.
 */
export function embedSourceFor(station: Station): EmbedSource | null {
  const provider = station.provider;
  const raw = station.playlistUrl?.trim();
  if (!provider || !raw) return null;
  if (provider !== 'youtube' && provider !== 'spotify') return null;
  if (!isSafeUrl(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();

  if (provider === 'youtube') {
    if (!YOUTUBE_HOSTS.has(host) || parsed.pathname !== '/playlist') return null;
    const list = parsed.searchParams.get('list');
    if (!list || !PLAYLIST_ID.test(list) || PLACEHOLDER_ID.test(list)) return null;
    return { provider, playlistId: list, url: raw };
  }

  if (host !== 'open.spotify.com') return null;
  const match = parsed.pathname.match(SPOTIFY_PLAYLIST_PATH);
  if (!match?.[1] || PLACEHOLDER_ID.test(match[1])) return null;
  return { provider, playlistId: match[1], url: raw };
}

/** True when the app may play this station itself: local audio or provider embed. */
export function isPlayableDecision(
  decision: SourceDecision,
): decision is Extract<SourceDecision, { kind: 'play' } | { kind: 'embed' }> {
  return decision.kind === 'play' || decision.kind === 'embed';
}

/**
 * Single place that decides how a station may be used.
 * Nothing in the UI may bypass this: no scraping, no proxying, no fake playback.
 */
export function decideSource(station: Station): SourceDecision {
  const primary = station.url?.trim() ?? '';
  const unverified = station.status === 'offline' || station.status === 'unknown';

  // An explicit, validated provider playlist is the strongest signal — but an
  // unverified station is never promoted to playable.
  const embed = embedSourceFor(station);
  if (embed && !unverified) return { kind: 'embed', source: embed };

  if (station.action === 'play') {
    const audio = station.audioUrl?.trim() ?? '';
    if (!audio) return { kind: 'open', url: primary };
    if (!isSafeUrl(audio)) return { kind: 'blocked', reason: 'Audio URL failed validation.' };
    if (unverified) {
      return { kind: 'check', url: primary };
    }
    return { kind: 'play', audioUrl: audio };
  }

  if (!isSafeUrl(primary)) return { kind: 'blocked', reason: 'Source URL failed validation.' };
  if (unverified) {
    return { kind: 'check', url: primary };
  }
  return { kind: 'open', url: primary };
}

/** What the primary hero button should say. */
export function primaryAction(station: Station): 'play' | 'open' | 'check' | 'blocked' {
  const kind = decideSource(station).kind;
  return kind === 'embed' ? 'play' : kind;
}

export function labelForDecision(decision: SourceDecision): string {
  switch (decision.kind) {
    case 'play':
    case 'embed':
      return 'Play';
    case 'open':
      return 'Enter Station';
    case 'check':
      return 'Check Station';
    case 'blocked':
      return 'Unavailable';
  }
}

/** Resolve the audio URL for playback, or null when the station must not play here. */
export function audioUrlFor(station: Station): string | null {
  const decision = decideSource(station);
  return decision.kind === 'play' ? decision.audioUrl : null;
}

export function navigateSource(station: Station): boolean {
  const decision = decideSource(station);
  if (decision.kind === 'blocked') return false;
  if (isPlayableDecision(decision)) return false;
  return openExternally(decision.url);
}

export { classifyUrl };
