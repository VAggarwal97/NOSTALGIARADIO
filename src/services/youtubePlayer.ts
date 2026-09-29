import type { EmbedSource } from '../lib/sourcePolicy';
import type { EngineEvents, ProviderEngine } from './engine';
import { loadScriptOnce } from './scriptLoader';

const API_SRC = 'https://www.youtube.com/iframe_api';

/** Minimal typings for the subset of the YouTube IFrame Player API we drive. */
interface YTPlayerInstance {
  cuePlaylist(options: { list: string; listType: 'playlist'; index?: number; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, seekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getDuration(): number;
  getCurrentTime(): number;
  /** Undocumented but long-standing; guarded so a change degrades to "no title". */
  getVideoData?: () => { title?: string } | undefined;
  destroy(): void;
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the official IFrame API once and resolves the `YT` namespace. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube API initialised without a player.'));
    };
    loadScriptOnce(API_SRC).catch((error) => {
      apiPromise = null;
      reject(error);
    });
  });
  return apiPromise;
}

/**
 * YouTube playback through the official IFrame API.
 *
 * The visible iframe lives in the engine dock (never faked with a fake UI).
 * The playlist itself auto-advances inside the embed; this engine only answers
 * play / pause / seek / volume with real provider state.
 */
export function createYouTubeEngine(host: HTMLElement, events: EngineEvents): ProviderEngine {
  let api: YTNamespace | null = null;
  let player: YTPlayerInstance | null = null;
  let ready = false;
  let destroyed = false;
  let progressTimer: number | null = null;
  const queue: Array<() => void> = [];

  const exec = (command: () => void) => {
    if (destroyed) return;
    if (ready && player) command();
    else queue.push(command);
  };

  const stopTimer = () => {
    if (progressTimer !== null) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
  };

  const emitProgress = () => {
    if (!player) return;
    const duration = player.getDuration();
    events.onProgress(
      player.getCurrentTime() || 0,
      Number.isFinite(duration) && duration > 0 ? duration : 0,
    );
  };

  const startTimer = () => {
    if (progressTimer !== null) return;
    progressTimer = window.setInterval(emitProgress, 1000);
  };

  const readTitle = () => {
    try {
      const data = player?.getVideoData?.();
      events.onTitle(data?.title ? data.title : null);
    } catch {
      events.onTitle(null);
    }
  };

  events.onStatus('loading');

  loadYouTubeApi()
    .then((YT) => {
      if (destroyed) return;
      api = YT;
      const mount = document.createElement('div');
      host.appendChild(mount);
      player = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          controls: 1,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (destroyed) return;
            ready = true;
            queue.splice(0).forEach((command) => command());
          },
          onStateChange: (event: { data: number }) => {
            if (destroyed || !api) return;
            const S = api.PlayerState;
            switch (event.data) {
              case S.PLAYING:
                events.onStatus('playing');
                readTitle();
                emitProgress();
                startTimer();
                break;
              case S.PAUSED:
                events.onStatus('paused');
                stopTimer();
                emitProgress();
                break;
              case S.BUFFERING:
                events.onStatus('loading');
                break;
              case S.CUED:
                events.onStatus('paused');
                emitProgress();
                break;
              case S.ENDED:
                // The playlist simply finished — paused, never an error.
                events.onStatus('paused');
                stopTimer();
                break;
              default:
                break;
            }
          },
          onError: () => {
            stopTimer();
            events.onStatus('error', 'This track is unavailable at its source — try another station.');
          },
        },
      });
    })
    .catch(() => {
      if (destroyed) return;
      stopTimer();
      events.onStatus('error', 'YouTube could not load. Check your connection or try another station.');
    });

  return {
    load(source: EmbedSource, autoplay: boolean) {
      stopTimer();
      events.onStatus('loading');
      events.onProgress(0, 0);
      events.onTitle(null);
      exec(() => {
        player?.cuePlaylist({ list: source.playlistId, listType: 'playlist' });
        if (autoplay) player?.playVideo();
      });
    },
    play() {
      exec(() => player?.playVideo());
    },
    pause() {
      exec(() => player?.pauseVideo());
    },
    seek(seconds: number) {
      if (!Number.isFinite(seconds)) return;
      exec(() => player?.seekTo(Math.max(0, seconds), true));
    },
    setVolume(volume: number) {
      const value = Math.round(Math.min(1, Math.max(0, volume)) * 100);
      exec(() => player?.setVolume(value));
    },
    setMuted(muted: boolean) {
      exec(() => (muted ? player?.mute() : player?.unMute()));
    },
    destroy() {
      destroyed = true;
      stopTimer();
      queue.length = 0;
      try {
        player?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      player = null;
      api = null;
      host.textContent = '';
    },
  };
}
