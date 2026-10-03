/**
 * What this listener chose last time — volume, mute, tuning, and whether the
 * radio has ever played (the "Welcome back" flag). Local to this browser,
 * never sent anywhere, never a user identity. SSR and privacy-restricted
 * storages degrade to `null` without throwing.
 */

export type ScopePreference = 'channel' | 'local';

export interface TuningPreference {
  category: string;
  stationId: string | null;
  scope: ScopePreference;
}

export interface PlaybackPreference {
  volume: number | null;
  muted: boolean;
  /** The visitor has actually heard this radio before (first play marked it). */
  hasPlayed: boolean;
}

const TUNING_KEY = 'nostalgia.tuning.v1';
const VOLUME_KEY = 'nostalgia.volume.v1';
const MUTED_KEY = 'nostalgia.muted.v1';
const PLAYED_KEY = 'nostalgia.played.v1';

const storage = (kind: 'localStorage' | 'sessionStorage'): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window[kind] ?? null;
  } catch {
    return null; // blocked storage (private mode) — preferences are optional
  }
};

const read = (kind: 'localStorage' | 'sessionStorage', key: string): string | null => {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (kind: 'localStorage' | 'sessionStorage', key: string, value: string): void => {
  try {
    storage(kind)?.setItem(key, value);
  } catch {
    /* quota or policy — the next visit simply starts fresh */
  }
};

export function loadTuning(): TuningPreference | null {
  const raw = read('localStorage', TUNING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TuningPreference>;
    if (typeof parsed.category !== 'string') return null;
    return {
      category: parsed.category,
      stationId: typeof parsed.stationId === 'string' ? parsed.stationId : null,
      scope: parsed.scope === 'local' ? 'local' : 'channel',
    };
  } catch {
    return null;
  }
}

export function saveTuning(tuning: TuningPreference): void {
  write('localStorage', TUNING_KEY, JSON.stringify(tuning));
}

export function loadPlayback(): PlaybackPreference {
  const volumeRaw = read('localStorage', VOLUME_KEY);
  const volume = volumeRaw !== null && Number.isFinite(Number(volumeRaw)) ? Number(volumeRaw) : null;
  return {
    volume: volume !== null && volume >= 0 && volume <= 1 ? volume : null,
    muted: read('localStorage', MUTED_KEY) === '1',
    hasPlayed: read('localStorage', PLAYED_KEY) === '1',
  };
}

export function saveVolume(value: number): void {
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    write('localStorage', VOLUME_KEY, String(Math.round(value * 100) / 100));
  }
}

export function saveMuted(muted: boolean): void {
  write('localStorage', MUTED_KEY, muted ? '1' : '0');
}

/** First real playback marks the session: the next visit may say "welcome". */
export function markHasPlayed(): void {
  write('localStorage', PLAYED_KEY, '1');
}
