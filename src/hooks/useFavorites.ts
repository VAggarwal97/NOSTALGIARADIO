import { useCallback, useEffect, useState } from 'react';
import { readStringArray, writeJson } from '../lib/storage';
import { STATIONS } from '../data/stations';

/** Favourites are device-local IDs only. No account, no upload, no history server. */
export function useFavorites() {
  const [ids, setIds] = useState<string[]>(() => readStringArray('favorites'));

  useEffect(() => {
    writeJson('favorites', ids);
  }, [ids]);

  const toggle = useCallback((id: string) => {
    setIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }, []);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  const stations = ids
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter((s): s is (typeof STATIONS)[number] => Boolean(s));

  return { ids, stations, toggle, has, count: ids.length };
}
