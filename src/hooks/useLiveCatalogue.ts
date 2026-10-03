import { useEffect, useSyncExternalStore } from 'react';

import {
  getCatalogue,
  startLiveCatalogue,
  subscribeCatalogue,
} from '../lib/live-catalogue';
import type { CatalogueSnapshot } from '../lib/live-catalogue';

/**
 * Subscribes this component to the live catalogue (admin edits converge
 * through realtime/focus refetch). SSR and first paint always see the bundled
 * snapshot — hydration only ever replaces it after a trustworthy fetch.
 */
export function useLiveCatalogue(): CatalogueSnapshot {
  useEffect(() => {
    startLiveCatalogue();
  }, []);
  return useSyncExternalStore(subscribeCatalogue, getCatalogue, getCatalogue);
}
