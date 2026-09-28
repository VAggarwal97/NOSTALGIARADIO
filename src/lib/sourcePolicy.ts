import type { Station } from '../types/station';
import { classifyUrl, isSafeUrl, openExternally } from './urlSafety';

export type SourceDecision =
  | { kind: 'play'; audioUrl: string }
  | { kind: 'open'; url: string }
  | { kind: 'check'; url: string }
  | { kind: 'blocked'; reason: string };

/**
 * Single place that decides how a station may be used.
 * Nothing in the UI may bypass this: no scraping, no proxying, no fake playback.
 */
export function decideSource(station: Station): SourceDecision {
  const primary = station.url?.trim() ?? '';
  const unverified = station.status === 'offline' || station.status === 'unknown';

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
  return decideSource(station).kind;
}

export function labelForDecision(decision: SourceDecision): string {
  switch (decision.kind) {
    case 'play':
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
  if (decision.kind === 'play') return false;
  return openExternally(decision.url);
}

export { classifyUrl };
