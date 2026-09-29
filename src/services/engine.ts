import type { EmbedSource } from '../lib/sourcePolicy';

export type EngineStatus = 'loading' | 'playing' | 'paused' | 'error';

/**
 * What an engine reports back to the player manager.
 * Every value is real data from the provider — durations, titles and states are
 * never invented when the provider doesn't report them.
 */
export interface EngineEvents {
  onStatus(status: EngineStatus, error?: string): void;
  /** Real seconds. `duration` stays 0 until the provider reports it. */
  onProgress(currentTime: number, duration: number): void;
  /** Real track title when the provider exposes one; otherwise null. */
  onTitle(title: string | null): void;
  /** The loaded video/track finished, or the playlist rested — see PlayerManager. */
  onEnded?(): void;
}

/**
 * The one interface the app talks to. Both official integrations implement it,
 * so no component ever branches on which provider is playing.
 */
export interface ProviderEngine {
  /** Swap the loaded playlist. Cued paused unless `autoplay` is true. */
  load(source: EmbedSource, autoplay: boolean): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** 0..1 — engines without a volume API implement a no-op. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}
