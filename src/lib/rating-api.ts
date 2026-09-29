import { randomId } from './id';

/**
 * Anonymous station ratings — one rating per visitor per station, aggregated
 * honestly: there are no seeded numbers, so a station with no ratings says so
 * until somebody actually rates it.
 *
 * V1 keeps ratings in memory behind this API-shaped interface. A real backend
 * with `UNIQUE(station_id, visitor_id)` (e.g. Supabase) can replace
 * `createLocalRatingApi` without touching the UI — the constraint lives
 * server-side, never in the frontend.
 */

export interface StationRating {
  stationId: string;
  /** Total ratings from all visitors. */
  count: number;
  /** Mean score, rounded to one decimal — null until the first rating. */
  average: number | null;
  /** This session's own rating, if it has left one. */
  mine: number | null;
}

export interface RatingApi {
  get(stationId: string): Promise<StationRating>;
  /** 1–5. Re-rating updates this session's row instead of adding another. */
  rate(stationId: string, value: number): Promise<StationRating>;
}

/** In-memory store: stationId → visitorId → rating. */
type Store = Map<string, Map<string, number>>;

function summarize(store: Store, stationId: string, visitorId: string): StationRating {
  const ratings = store.get(stationId);
  if (!ratings || ratings.size === 0) {
    return { stationId, count: 0, average: null, mine: null };
  }
  let total = 0;
  for (const value of ratings.values()) total += value;
  return {
    stationId,
    count: ratings.size,
    average: Math.round((total / ratings.size) * 10) / 10,
    mine: ratings.get(visitorId) ?? null,
  };
}

export function createLocalRatingApi(visitorId: string = randomId()): RatingApi {
  const store: Store = new Map();

  return {
    get(stationId) {
      return Promise.resolve(summarize(store, stationId, visitorId));
    },
    async rate(stationId, value) {
      const rounded = Math.round(value);
      if (!Number.isFinite(value) || rounded < 1 || rounded > 5) {
        throw new Error('Rating must be between 1 and 5.');
      }
      let ratings = store.get(stationId);
      if (!ratings) {
        ratings = new Map();
        store.set(stationId, ratings);
      }
      // Upsert, not append: one visitor, one vote — changing your mind
      // updates the row instead of inflating the count.
      ratings.set(visitorId, rounded);
      return summarize(store, stationId, visitorId);
    },
  };
}

let shared: RatingApi | null = null;

/** App-wide rating store for this session. */
export function getRatingApi(): RatingApi {
  if (!shared) shared = createLocalRatingApi();
  return shared;
}
