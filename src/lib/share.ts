import type { Station } from '../types/station';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

function stationUrl(station: Station): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?station=${encodeURIComponent(station.id)}`;
}

function buildText(station: Station): string {
  return `${station.name} — Nostalgia Radio\n${station.description}\n${stationUrl(station)}`;
}

/** Web Share API with a clipboard fallback. Never throws into the UI. */
export async function shareStation(station: Station): Promise<ShareResult> {
  const url = stationUrl(station);
  const text = buildText(station);

  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await navigator.share({ title: `Nostalgia Radio — ${station.name}`, text, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      /* fall through to clipboard */
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
