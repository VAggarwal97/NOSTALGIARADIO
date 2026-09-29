import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Who reports the end of a track: the local audio element or a provider engine. */
export type PlaybackEndOrigin = 'audio' | 'request' | 'station-embed';

export interface AudioPlayerOptions {
  /** Fired when the current track ends so the rail can advance. */
  onEnded?: (origin?: PlaybackEndOrigin) => void;
}

export interface AudioPlayerApi {
  status: PlayerStatus;
  error: string | null;
  stationId: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  isPlayable: boolean;
  analyser: AnalyserNode | null;
  load: (stationId: string, url: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  stop: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  seek: (seconds: number) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Normalises every audio state the UI can be in.
 * One element, one state machine: idle → loading → playing ⇄ paused, with error → retry.
 */
export function useAudioPlayer(options: AudioPlayerOptions = {}): AudioPlayerApi {
  const { onEnded } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [isPlayable, setIsPlayable] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  if (audioRef.current === null && typeof Audio !== 'undefined') {
    const element = new Audio();
    element.preload = 'none';
    element.crossOrigin = 'anonymous';
    audioRef.current = element;
  }

  // Wire element events exactly once.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    const onPlay = () => {
      setStatus('playing');
      setError(null);
    };
    const onPause = () => setStatus((current) => (current === 'error' ? current : 'paused'));
    const onLoadStart = () => setStatus('loading');
    const onCanPlay = () => setStatus((current) => (current === 'playing' ? current : 'paused'));
    const onWaiting = () => setStatus('loading');
    const onTime = () => setCurrentTime(element.currentTime);
    const onMeta = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const onEndedEvent = () => {
      setStatus('paused');
      onEndedRef.current?.('audio');
    };
    const onErrorEvent = () => {
      setStatus('error');
      setError("This station isn't responding right now. Try again or open the station page.");
    };

    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('loadstart', onLoadStart);
    element.addEventListener('canplay', onCanPlay);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('durationchange', onMeta);
    element.addEventListener('ended', onEndedEvent);
    element.addEventListener('error', onErrorEvent);

    return () => {
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('loadstart', onLoadStart);
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('loadedmetadata', onMeta);
      element.removeEventListener('durationchange', onMeta);
      element.removeEventListener('ended', onEndedEvent);
      element.removeEventListener('error', onErrorEvent);
    };
  }, []);

  // Volume/mute mirror.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.volume = volume;
    element.muted = muted;
  }, [volume, muted]);

  const ensureGraph = useCallback((): AnalyserNode | null => {
    const element = audioRef.current;
    if (!element) return null;
    try {
      if (!contextRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        const context = new Ctor();
        const source = context.createMediaElementSource(element);
        const node = context.createAnalyser();
        node.fftSize = 64;
        node.smoothingTimeConstant = 0.75;
        source.connect(node);
        node.connect(context.destination);
        contextRef.current = context;
        sourceRef.current = source;
        analyserRef.current = node;
        setAnalyser(node);
      }
      if (contextRef.current.state === 'suspended') void contextRef.current.resume();
      return analyserRef.current;
    } catch {
      // Visualiser is decoration; playback must work without it.
      return null;
    }
  }, []);

  const load = useCallback((id: string, url: string) => {
    const element = audioRef.current;
    if (!element) return;
    element.pause();
    element.src = url;
    element.load();
    setStationId(id);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setIsPlayable(true);
    setStatus('paused');
  }, []);

  const play = useCallback(async () => {
    const element = audioRef.current;
    if (!element || !element.src) return;
    ensureGraph();
    try {
      setStatus('loading');
      await element.play();
    } catch (err) {
      const blocked = err instanceof DOMException && err.name === 'NotAllowedError';
      setStatus('error');
      setError(
        blocked
          ? 'Playback needs a tap or click before the browser will start audio. Try again.'
          : "This station isn't responding right now. Try again or open the station page.",
      );
    }
  }, [ensureGraph]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(async () => {
    const element = audioRef.current;
    if (!element || !element.src) return;
    if (element.paused) await play();
    else element.pause();
  }, [play]);

  const stop = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
    setStationId(null);
    setIsPlayable(false);
    setStatus('idle');
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const setVolume = useCallback((value: number) => {
    const next = clamp(value, 0, 1);
    setVolumeState(next);
    if (next > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((current) => !current), []);

  const seek = useCallback((seconds: number) => {
    const element = audioRef.current;
    if (!element || !Number.isFinite(seconds)) return;
    const max = Number.isFinite(element.duration) ? element.duration : seconds;
    element.currentTime = clamp(seconds, 0, max);
    setCurrentTime(element.currentTime);
  }, []);

  return useMemo(
    () => ({
      status,
      error,
      stationId,
      currentTime,
      duration,
      volume,
      muted,
      isPlayable,
      analyser,
      load,
      play,
      pause,
      toggle,
      stop,
      setVolume,
      toggleMute,
      seek,
    }),
    [
      status,
      error,
      stationId,
      currentTime,
      duration,
      volume,
      muted,
      isPlayable,
      analyser,
      load,
      play,
      pause,
      toggle,
      stop,
      setVolume,
      toggleMute,
      seek,
    ],
  );
}
