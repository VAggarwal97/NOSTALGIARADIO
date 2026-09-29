import { useEffect, useState } from 'react';
import { getPresence, type PresenceApi } from '../lib/presence-api';

/**
 * Approximate live sessions ("listening now"), resolved *after* first paint —
 * null until the presence channel answers, so the UI never waits on it and SSR
 * never emits a number it cannot know.
 */
export function usePresence(): number | null {
  const [sessions, setSessions] = useState<number | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    // Defer one frame: render → paint → then join the channel.
    const timer = window.setTimeout(() => {
      const presence: PresenceApi = getPresence();
      unsubscribe = presence.subscribe(setSessions);
    }, 60);
    return () => {
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);

  return sessions;
}
