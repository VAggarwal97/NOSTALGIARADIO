import { useEffect, useRef } from 'react';

import type { PlayerManager, ProviderId } from '../services/playerManager';

interface EngineDockProps {
  manager: PlayerManager;
  provider: ProviderId;
  /** Real provider-reported track title, when the provider exposes one. */
  trackTitle: string | null;
  stationName: string;
}

/**
 * Where the official provider iframe actually lives.
 *
 * It stays visible — the site never disguises a hidden YouTube/Spotify player
 * as its own UI. The pill drives playback through the manager; this element is
 * only the iframe's home, labelled with the provider so the source is obvious.
 * The dock stays mounted while a provider station is active (minimising the
 * pill hides the pill, not the source).
 */
export function EngineDock({ manager, provider, trackTitle, stationName }: EngineDockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Attach once per mount: provider swaps are handled inside the manager,
  // so re-running on a provider change would destroy a healthy engine.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    manager.attach(host);
    return () => manager.detach();
  }, [manager]);

  const label = provider === 'youtube' ? 'YouTube' : 'Spotify';
  const now = trackTitle ?? stationName;

  return (
    <section className="engine-dock" data-provider={provider} aria-label={`${label} player`}>
      <div className="engine-head">
        <span className="engine-badge">
          <span className="engine-dot" aria-hidden="true" />
          {label}
        </span>
        <span className="engine-now">{now}</span>
      </div>
      <div className="engine-frame" ref={hostRef} />
    </section>
  );
}
