import type { EmbedSource } from '../lib/sourcePolicy';
import type { EngineEvents, ProviderEngine } from './engine';
import { createSpotifyEngine } from './spotifyPlayer';
import { createYouTubeEngine } from './youtubePlayer';

export type ProviderId = 'youtube' | 'spotify';
export type ManagerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface ProviderState {
  provider: ProviderId | null;
  stationId: string | null;
  status: ManagerStatus;
  error: string | null;
  /** Real seconds from the provider; 0 while unknown — never simulated. */
  currentTime: number;
  duration: number;
  /** Real track title when the provider reports one (YouTube); else null. */
  title: string | null;
  volume: number;
  muted: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Drives the official provider engines behind one tiny interface.
 *
 * The engines themselves only materialise once the engine dock (a visible
 * iframe host) has mounted — until then `load()` just records intent, so a
 * station switch before mount never loses playback. React subscribes through
 * `subscribe`/`getState`; components never touch an engine directly.
 */
export class PlayerManager {
  private state: ProviderState = {
    provider: null,
    stationId: null,
    status: 'idle',
    error: null,
    currentTime: 0,
    duration: 0,
    title: null,
    volume: 0.8,
    muted: false,
  };

  private listeners = new Set<() => void>();
  private endedListeners = new Set<(origin: 'request' | 'station-embed') => void>();
  private host: HTMLElement | null = null;
  private engine: ProviderEngine | null = null;
  private engineProvider: ProviderId | null = null;
  private desired: { stationId: string; source: EmbedSource } | null = null;
  private wantPlay = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): ProviderState => this.state;

  /**
   * Track boundaries reported by the engines: a community request finished,
   * or a provider playlist changed video / rested at its end. The app decides
   * what airs next — the manager never moves playback on its own.
   */
  onEnded = (listener: (origin: 'request' | 'station-embed') => void): (() => void) => {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  };

  private emitEnded(): void {
    if (!this.desired) return;
    const entity = this.desired.source.entity;
    const origin: 'request' | 'station-embed' =
      entity === 'video' || entity === 'track' ? 'request' : 'station-embed';
    this.endedListeners.forEach((listener) => listener(origin));
  }

  private patch(partial: Partial<ProviderState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  /** The engine dock hands us its iframe host; pending intent materialises here. */
  attach(host: HTMLElement): void {
    this.host = host;
    if (this.desired && this.engineProvider !== this.desired.source.provider) this.spawn();
  }

  /** Unmounting the dock destroys the iframe; intent (`desired`) is preserved. */
  detach(): void {
    this.host = null;
    this.engine?.destroy();
    this.engine = null;
    this.engineProvider = null;
  }

  load(stationId: string, source: EmbedSource): void {
    this.desired = { stationId, source };
    this.wantPlay = false;
    this.patch({
      provider: source.provider,
      stationId,
      status: 'loading',
      error: null,
      currentTime: 0,
      duration: 0,
      title: null,
    });
    if (!this.host) return; // dock will spawn on attach
    if (this.engine && this.engineProvider === source.provider) {
      this.engine.load(source, false); // same iframe — swap playlists, never recreate
    } else {
      this.spawn();
    }
  }

  play(): void {
    this.wantPlay = true;
    this.engine?.play();
    // No engine yet: `wantPlay` is honoured when the dock attaches.
  }

  pause(): void {
    this.wantPlay = false;
    this.patch({ status: 'paused' });
    this.engine?.pause();
  }

  toggle(): void {
    if (this.state.status === 'playing') this.pause();
    else this.play();
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const target = Math.max(0, seconds);
    this.patch({ currentTime: target });
    this.engine?.seek(target);
  }

  setVolume(value: number): void {
    const volume = clamp(value, 0, 1);
    this.patch({ volume });
    this.engine?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    this.patch({ muted });
    this.engine?.setMuted(muted);
  }

  /** Leaving provider playback entirely (switching to a local-audio station). */
  stop(): void {
    this.desired = null;
    this.wantPlay = false;
    this.engine?.destroy();
    this.engine = null;
    this.engineProvider = null;
    this.patch({
      provider: null,
      stationId: null,
      status: 'idle',
      error: null,
      currentTime: 0,
      duration: 0,
      title: null,
    });
  }

  private spawn(): void {
    if (!this.host || !this.desired) return;
    const { source } = this.desired;

    this.engine?.destroy();
    this.engine = null;
    this.engineProvider = source.provider;

    const events: EngineEvents = {
      onStatus: (status, error) => this.patch({ status, error: error ?? null }),
      onProgress: (currentTime, duration) => this.patch({ currentTime, duration }),
      onTitle: (title) => {
        // A provider playlist advancing to its next video reports a fresh
        // title — that is a track boundary for the community queue. Requests
        // (entity video/track) never take this path; they end via onEnded.
        const entity = this.desired?.source.entity;
        const onPlaylist = !entity || entity === 'playlist';
        const previous = this.state.title;
        if (onPlaylist && previous && title && title !== previous) this.emitEnded();
        this.patch({ title });
      },
      onEnded: () => this.emitEnded(),
    };

    this.engine =
      source.provider === 'youtube'
        ? createYouTubeEngine(this.host, events)
        : createSpotifyEngine(this.host, source, events);

    // Carry the app-wide volume into every new engine before anything plays.
    this.engine.load(source, this.wantPlay);
    this.engine.setVolume(this.state.volume);
    this.engine.setMuted(this.state.muted);
  }
}

let singleton: PlayerManager | null = null;

/** One manager per page — the pill, hero and dock all speak to the same engine. */
export function getPlayerManager(): PlayerManager {
  if (!singleton) singleton = new PlayerManager();
  return singleton;
}
