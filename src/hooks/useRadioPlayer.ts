import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAudioPlayer } from './useAudioPlayer';
import type { AudioPlayerOptions, PlayerStatus } from './useAudioPlayer';
import { getPlayerManager } from '../services/playerManager';
import type { ProviderId } from '../services/playerManager';
import type { SourceDecision } from '../lib/sourcePolicy';

/** The decisions this player knows how to execute. Everything else is a source page. */
export type PlayableDecision = Extract<SourceDecision, { kind: 'play' } | { kind: 'embed' }>;

export type ActiveEngine = 'audio' | ProviderId;

export interface RadioPlayerApi {
  /** Which engine the loaded station runs on: local audio or a provider embed. */
  engine: ActiveEngine | null;
  status: PlayerStatus;
  error: string | null;
  stationId: string | null;
  /** Real provider-reported track title; null when only the station is known. */
  trackTitle: string | null;
  currentTime: number;
  duration: number;
  /** False when the provider has no volume API (Spotify) — the UI hides the control. */
  hasVolume: boolean;
  volume: number;
  muted: boolean;
  isPlayable: boolean;
  analyser: AnalyserNode | null;
  load: (stationId: string, decision: PlayableDecision) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  stop: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  seek: (seconds: number) => void;
}

const isProviderEngine = (engine: ActiveEngine | null): engine is ProviderId =>
  engine === 'youtube' || engine === 'spotify';

/**
 * One radio, two engines. Local demo audio keeps using the HTML audio element;
 * provider stations run through the PlayerManager's official embed. The app
 * only ever sees this unified surface — it never asks which provider is live.
 */
export function useRadioPlayer(options: AudioPlayerOptions = {}): RadioPlayerApi {
  const audio = useAudioPlayer(options);
  const manager = getPlayerManager();
  const provider = useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);

  const [engine, setEngineState] = useState<ActiveEngine | null>(null);
  const engineRef = useRef<ActiveEngine | null>(null);

  const setEngine = useCallback((next: ActiveEngine | null) => {
    engineRef.current = next;
    setEngineState(next);
  }, []);

  const providerActive = isProviderEngine(engine);

  // Provider boundaries (request finished, playlist video changed) reach the
  // same onEnded the local audio element uses — always via the latest closure.
  const onEndedRef = useRef(options.onEnded);
  onEndedRef.current = options.onEnded;
  useEffect(() => manager.onEnded((origin) => onEndedRef.current?.(origin)), [manager]);

  // Audio stays the single source of truth for volume/mute; mirror it into the
  // embed so a preference carries across station switches.
  useEffect(() => {
    manager.setVolume(audio.volume);
  }, [manager, audio.volume]);
  useEffect(() => {
    manager.setMuted(audio.muted);
  }, [manager, audio.muted]);

  const load = useCallback(
    (stationId: string, decision: PlayableDecision) => {
      if (decision.kind === 'embed') {
        audio.stop(); // one audible engine at a time — always stop the other first
        setEngine(decision.source.provider);
        manager.load(stationId, decision.source);
      } else {
        manager.stop();
        setEngine('audio');
        audio.load(stationId, decision.audioUrl);
      }
    },
    [audio, manager, setEngine],
  );

  const play = useCallback(async () => {
    if (isProviderEngine(engineRef.current)) {
      manager.play();
      return;
    }
    await audio.play();
  }, [audio, manager]);

  const pause = useCallback(() => {
    if (isProviderEngine(engineRef.current)) {
      manager.pause();
      return;
    }
    audio.pause();
  }, [audio, manager]);

  const toggle = useCallback(async () => {
    if (isProviderEngine(engineRef.current)) {
      manager.toggle();
      return;
    }
    await audio.toggle();
  }, [audio, manager]);

  const stop = useCallback(() => {
    manager.stop();
    audio.stop();
    setEngine(null);
  }, [audio, manager, setEngine]);

  const seek = useCallback(
    (seconds: number) => {
      if (isProviderEngine(engineRef.current)) manager.seek(seconds);
      else audio.seek(seconds);
    },
    [audio, manager],
  );

  return useMemo(() => {
    const active = providerActive ? provider : null;
    const status = active ? active.status : audio.status;
    const error = active ? active.error : audio.error;
    const stationId = active ? active.stationId : audio.stationId;
    const currentTime = active ? active.currentTime : audio.currentTime;
    const duration = active ? active.duration : audio.duration;

    return {
      engine,
      status,
      error,
      stationId,
      trackTitle: active ? active.title : null,
      currentTime,
      duration,
      hasVolume: !active || active.provider === 'youtube',
      volume: audio.volume,
      muted: audio.muted,
      isPlayable: active
        ? active.stationId !== null && active.status !== 'error'
        : audio.isPlayable,
      analyser: audio.analyser,
      load,
      play,
      pause,
      toggle,
      stop,
      setVolume: audio.setVolume,
      toggleMute: audio.toggleMute,
      seek,
    };
  }, [engine, providerActive, provider, audio, load, play, pause, toggle, stop, seek]);
}
