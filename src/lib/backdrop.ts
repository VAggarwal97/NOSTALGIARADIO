import type { Station } from '../types/station';

/**
 * One backdrop per station per page load. The pick lives in module memory:
 * navigating between views or switching stations and back keeps the same
 * stage, while a reload draws a new one. Nothing is persisted — no storage,
 * no cookies, no fingerprint.
 */
const picks = new Map<string, string>();

/**
 * The stage image for this station on this page load: a random `backdrops`
 * entry (cached until reload) or null when the station offers no alternatives.
 * `random` is injectable purely so tests can be deterministic.
 */
export const sessionBackdrop = (
  station: Station | null | undefined,
  random: () => number = Math.random,
): string | null => {
  const pool = station?.backdrops;
  if (!station || !pool || pool.length === 0) return null;
  const cached = picks.get(station.id);
  if (cached) return cached;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  const choice = pool[index] ?? pool[0] ?? null;
  if (choice) picks.set(station.id, choice);
  return choice;
};

/** Test seam — forget this document's picks. */
export const resetBackdropPicks = (): void => {
  picks.clear();
};
