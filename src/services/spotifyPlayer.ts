import type { EmbedSource } from '../lib/sourcePolicy';
import type { EngineEvents, ProviderEngine } from './engine';
import { loadScriptOnce } from './scriptLoader';

const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

/** Minimal typings for the subset of the Spotify iFrame API we drive. */
interface SpotifyEmbedController {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Accepts a full playlist URL or a spotify: URI — we always pass the URL. */
  loadEntity(url: string): void;
  destroy(): void;
  addListener(event: string, handler: (payload?: { data?: SpotifyPlaybackState }) => void): void;
}

interface SpotifyPlaybackState {
  playingURI?: string;
  isPaused?: boolean;
  isBuffering?: boolean;
  /** Milliseconds — converted to seconds before it reaches the UI. */
  duration?: number;
  position?: number;
}

interface SpotifyIFrameAPI {
  createController(
    element: HTMLElement,
    options: { url?: string; uri?: string },
    callback: (controller: SpotifyEmbedController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
    /** Our stash so a second engine never waits for a callback that already fired. */
    __nostalgiaSpotifyAPI?: SpotifyIFrameAPI;
  }
}

let apiPromise: Promise<SpotifyIFrameAPI> | null = null;

/** Loads the official iFrame API once and resolves it. */
function loadSpotifyApi(): Promise<SpotifyIFrameAPI> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.__nostalgiaSpotifyAPI) return Promise.resolve(window.__nostalgiaSpotifyAPI);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    const previous = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      previous?.(api);
      window.__nostalgiaSpotifyAPI = api;
      resolve(api);
    };
    loadScriptOnce(API_SRC).catch((error) => {
      apiPromise = null;
      reject(error);
    });
  });
  return apiPromise;
}

const toSeconds = (ms: unknown): number =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;

/**
 * Spotify playback through the official iFrame API.
 *
 * The embed itself renders inside the engine dock — Spotify's controls, Spotify's
 * track list, Spotify's audio. This engine mirrors its real state (progress via
 * `playback_update`) into the pill. The API exposes no volume or skip methods,
 * so the pill honestly hides those controls for these stations.
 */
export function createSpotifyEngine(
  host: HTMLElement,
  initial: EmbedSource,
  events: EngineEvents,
): ProviderEngine {
  let controller: SpotifyEmbedController | null = null;
  let ready = false;
  let destroyed = false;
  let source: EmbedSource = initial;
  let endedFired = false;
  const queue: Array<() => void> = [];

  const exec = (command: () => void) => {
    if (destroyed) return;
    if (ready && controller) command();
    else queue.push(command);
  };

  events.onStatus('loading');

  loadSpotifyApi()
    .then((api) => {
      if (destroyed) return;
      const mount = document.createElement('div');
      host.appendChild(mount);
      api.createController(mount, { url: source.url }, (created) => {
        if (destroyed) {
          try {
            created.destroy();
          } catch {
            /* nothing to clean up */
          }
          return;
        }
        controller = created;
        ready = true;

        created.addListener('ready', () => {
          if (!destroyed) events.onStatus('paused');
        });
        created.addListener('playback_started', () => {
          if (destroyed) return;
          events.onStatus('playing');
          // Spotify exposes no per-track title through this API — stay honest.
          events.onTitle(null);
        });
        created.addListener('playback_update', (payload) => {
          if (destroyed || !payload?.data) return;
          const data = payload.data;
          events.onProgress(toSeconds(data.position), toSeconds(data.duration));
          if (data.isBuffering) events.onStatus('loading');
          else events.onStatus(data.isPaused ? 'paused' : 'playing');

          // A single-track request is over when the provider rests on it or
          // moves to another entity — read from real provider state, never
          // timed or simulated. Playlists are unaffected (entity guard).
          if (source.entity === 'track' && !endedFired) {
            const movedOn = data.playingURI?.includes(source.playlistId) === false;
            const atRest =
              data.duration !== undefined &&
              data.position !== undefined &&
              data.duration - data.position <= 750;
            if (movedOn || atRest) {
              endedFired = true;
              events.onEnded?.();
            }
          }
        });

        queue.splice(0).forEach((command) => command());
      });
    })
    .catch(() => {
      if (destroyed) return;
      events.onStatus('error', 'Spotify could not load. Check your connection or try another station.');
    });

  return {
    load(next: EmbedSource, autoplay: boolean) {
      const changed = next.url !== source.url;
      source = next;
      endedFired = false;
      events.onStatus('loading');
      events.onProgress(0, 0);
      events.onTitle(null);
      exec(() => {
        if (changed) controller?.loadEntity(next.url);
        if (autoplay) controller?.play();
      });
    },
    play() {
      exec(() => controller?.play());
    },
    pause() {
      exec(() => controller?.pause());
    },
    seek(seconds: number) {
      if (!Number.isFinite(seconds)) return;
      exec(() => controller?.seek(Math.max(0, Math.floor(seconds))));
    },
    setVolume() {
      /* The Spotify iFrame API exposes no volume method — the UI hides the control. */
    },
    setMuted() {
      /* See setVolume. */
    },
    destroy() {
      destroyed = true;
      queue.length = 0;
      try {
        controller?.destroy();
      } catch {
        /* already gone */
      }
      controller = null;
      host.textContent = '';
    },
  };
}
