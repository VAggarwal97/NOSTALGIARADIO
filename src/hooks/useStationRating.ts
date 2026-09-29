import { useCallback, useEffect, useState } from 'react';
import { getRatingApi, type StationRating } from '../lib/rating-api';

/**
 * Rating data for the current station. The summary arrives after first paint
 * (the control shows an honest empty state until it does) and re-rates update
 * this session's row instead of adding a new one.
 */
export function useStationRating(stationId: string | null) {
  const [summary, setSummary] = useState<StationRating | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    setSummary(null); // switching stations must not show stale numbers
    if (!stationId) return;
    void getRatingApi()
      .get(stationId)
      .then((next) => {
        if (alive) setSummary(next);
      });
    return () => {
      alive = false;
    };
  }, [stationId]);

  const rate = useCallback(
    async (value: number): Promise<StationRating | null> => {
      if (!stationId || pending) return null;
      setPending(true);
      try {
        const next = await getRatingApi().rate(stationId, value);
        setSummary(next);
        return next;
      } finally {
        setPending(false);
      }
    },
    [stationId, pending],
  );

  return { summary, pending, rate };
}
