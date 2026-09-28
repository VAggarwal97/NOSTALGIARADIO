import type { CategoryId, Station } from '../types/station';
import { STATIONS, FEATURED_STATIONS } from '../data/stations';
import { CATEGORIES } from '../data/categories';

export function stationsForCategory(category: CategoryId): Station[] {
  if (category === 'mix') return FEATURED_STATIONS;
  return STATIONS.filter((s) => s.category === category);
}

export function findStation(id: string | null | undefined): Station | undefined {
  if (!id) return undefined;
  return STATIONS.find((s) => s.id === id);
}

export function neighbours(station: Station | null, pool: Station[]): {
  previous: Station | null;
  next: Station | null;
} {
  if (!station || pool.length === 0) return { previous: null, next: null };
  const index = pool.findIndex((s) => s.id === station.id);
  if (index === -1) return { previous: pool[pool.length - 1], next: pool[0] };
  return {
    previous: pool[(index - 1 + pool.length) % pool.length],
    next: pool[(index + 1) % pool.length],
  };
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

const normalize = (value: string): string => value.toLowerCase().trim();

function haystack(station: Station): string {
  return normalize(
    [
      station.name,
      station.description,
      categoryLabel(station.category),
      station.region ?? '',
      station.era ?? '',
      ...(station.language ?? []),
      ...(station.tags ?? []),
    ].join(' '),
  );
}

export function searchStations(query: string, limit = 12): Station[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  return STATIONS.map((station) => {
    const text = haystack(station);
    if (!terms.every((term) => text.includes(term))) return null;
    const name = normalize(station.name);
    let score = 0;
    if (name.startsWith(q)) score += 100;
    else if (name.includes(q)) score += 60;
    if (name === q) score += 80;
    score += Math.min(station.heat ?? 0, 100) / 100;
    return { station, score };
  })
    .filter((entry): entry is { station: Station; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.station);
}

export function randomStation(excludeId?: string): Station {
  const pool = STATIONS.filter((s) => s.action === 'play' && s.id !== excludeId);
  const candidates = pool.length > 0 ? pool : STATIONS.filter((s) => s.id !== excludeId);
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? STATIONS[0];
}
