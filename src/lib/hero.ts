import { getCategory } from './live-catalogue';
import type { Station } from '../types/station';

export const DEFAULT_ACCENT = '#f05a45';

/**
 * Hero title is two lines: line 1 in ivory, line 2 in the station accent.
 * Explicit `titleLines` win; otherwise the trailing "Radio" / "FM" word becomes
 * line 2. Names without a trailing station word stay on one line.
 */
export function heroTitle(station: Station): [string, string] {
  if (station.titleLines) return station.titleLines;
  const match = station.name.match(/^(.*?)\s+(Radio|FM|Tapes|Records)$/);
  if (match?.[1]) return [match[1], match[2]];
  return [station.name, ''];
}

/** `TRAVEL · ROAD · PEOPLE · MEMORIES` — category, then the station's own words. */
export function heroEyebrow(station: Station): string {
  const category = getCategory(station.category);
  const words = (station.tags ?? []).slice(0, 3);
  return [category?.label ?? station.category, ...words].join(' · ');
}

/** `⌖ Highway · Hindi · 90s–2000s` — only fields that actually exist. */
export function heroMeta(station: Station): string[] {
  return [station.region, station.language?.[0], station.era].filter(
    (value): value is string => Boolean(value),
  );
}

export function stationAccent(station: Station): string {
  return station.accent ?? getCategory(station.category)?.accent ?? DEFAULT_ACCENT;
}
