import { useEffect, useState } from 'react';
import type { Station } from '../types/station';
import type { PlayerState } from './CinematicHero';
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  VolumeIcon,
  MuteIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  QueueIcon,
} from './Icons';

interface FloatingPlayerProps {
  station: Station | null;
  playerState: PlayerState;
  isCurrentTrack: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  canPlay: boolean;
  /** Active provider embed, when the loaded station plays through one. */
  provider?: 'youtube' | 'spotify' | null;
  /** Real provider-reported track title, when available. */
  trackTitle?: string | null;
  /** What is on air right now when it is not the station itself (a community request). */
  contextLabel?: string | null;
  /** Honest vote aggregate behind the request — null while nobody has voted. */
  contextVotes?: number | null;
  /** This device voted for what is on air — the expanded player can say so. */
  contextHelped?: boolean;
  /** False when the provider exposes no volume API — the control is hidden, not faked. */
  hasVolume?: boolean;
  expanded: boolean;
  minimized: boolean;
  /** The stations previous / next traverse — the real queue, not a decoration. */
  queue: Station[];
  onToggleExpand: () => void;
  onToggleMinimize: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onSeek: (seconds: number) => void;
  onPick: (station: Station) => void;
}

const stateCopy: Record<PlayerState, string> = {
  ready: 'Ready',
  buffering: 'Loading',
  playing: 'On air',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Error',
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

/**
 * The primary interaction of the whole site: a floating glass pill.
 * Desktop — 680–720px, two rows (art · title · transport, then progress).
 * Mobile — compact rounded bar that expands in place.
 * Progress only renders when real duration data exists — never simulated.
 */
export function FloatingPlayer({
  station,
  playerState,
  isCurrentTrack,
  currentTime,
  duration,
  volume,
  muted,
  canPlay,
  provider = null,
  trackTitle = null,
  contextLabel = null,
  contextVotes = null,
  contextHelped = false,
  hasVolume = true,
  expanded,
  minimized,
  queue,
  onToggleExpand,
  onToggleMinimize,
  onPrevious,
  onNext,
  onTogglePlay,
  onVolume,
  onToggleMute,
  onSeek,
  onPick,
}: FloatingPlayerProps) {
  const [queueOpen, setQueueOpen] = useState(false);

  useEffect(() => {
    if (!queueOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueOpen]);

  const state: PlayerState = isCurrentTrack ? playerState : 'ready';
  const live = state === 'playing';
  const showProgress = isCurrentTrack && duration > 0;

  const providerLabel =
    provider === 'youtube' ? 'YouTube' : provider === 'spotify' ? 'Spotify' : null;
  const title = trackTitle ?? station?.nowPlaying?.title ?? station?.name ?? 'No station selected';
  const subParts = [stateCopy[state]];
  const hasTrackName = Boolean(trackTitle ?? station?.nowPlaying);
  if (contextLabel) {
    subParts.push(contextLabel);
    if (contextVotes) subParts.push(`${contextVotes} requested`);
  } else if (hasTrackName && station) subParts.push(station.name);
  else if (station?.demo) subParts.push('Sample audio');
  else if (station && !providerLabel) subParts.push('Live source');
  if (providerLabel) subParts.push(providerLabel);
  else if (!station) subParts.push('Pick a station');

  return (
    <>
      {minimized ? (
        <button type="button" className="now-playing" onClick={onToggleMinimize}>
          <span className="dot" aria-hidden="true" />
          Now Playing
        </button>
      ) : null}

      <div
        className="player"
        role="group"
        aria-label="Player controls"
        data-expanded={expanded}
        data-minimized={minimized}
      >
        <div className="player-row">
          {station ? (
            <img className="player-art" key={station.id} src={station.artwork} alt="" />
          ) : (
            <span className="player-art" aria-hidden="true" />
          )}

          <div className="player-meta">
            <div className="player-title">{title}</div>
            <div className="player-sub" data-state={state}>
              <span className="dot" aria-hidden="true" />
              {subParts.join(' · ')}
            </div>
          </div>

          <div className="player-controls">
            <button
              type="button"
              className="icon-btn player-step"
              onClick={onPrevious}
              title="Previous station"
            >
              <PrevIcon size={16} />
              <span className="visually-hidden">Previous station</span>
            </button>

            <button
              type="button"
              className="play-btn"
              onClick={onTogglePlay}
              disabled={!canPlay}
              title="Play / pause (Space)"
              aria-label={live ? 'Pause' : 'Play'}
            >
              {live ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
            </button>

            <button
              type="button"
              className="icon-btn player-step"
              onClick={onNext}
              title={contextLabel ? 'Next request' : 'Next station'}
            >
              <NextIcon size={16} />
              <span className="visually-hidden">{contextLabel ? 'Next request' : 'Next station'}</span>
            </button>

            <button
              type="button"
              className="icon-btn player-expand"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              title={expanded ? 'Collapse player' : 'Expand player'}
            >
              {expanded ? <ChevronDownIcon size={18} /> : <ChevronUpIcon size={18} />}
              <span className="visually-hidden">
                {expanded ? 'Collapse player' : 'Expand player'}
              </span>
            </button>
          </div>

          <div className="player-tools">
            {hasVolume ? (
              <div className="volume">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={onToggleMute}
                  aria-pressed={muted}
                  title="Mute (M)"
                >
                  {muted || volume === 0 ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
                  <span className="visually-hidden">Mute</span>
                </button>
                <label className="visually-hidden" htmlFor="player-volume">
                  Volume
                </label>
                <input
                  id="player-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : Math.round(volume * 100)}
                  onChange={(event) => onVolume(Number(event.target.value) / 100)}
                />
              </div>
            ) : null}

            <button
              type="button"
              className="icon-btn"
              onClick={() => setQueueOpen((open) => !open)}
              aria-expanded={queueOpen}
              aria-pressed={queueOpen}
              title="Queue — the stations up next"
            >
              <QueueIcon size={16} />
              <span className="visually-hidden">Queue</span>
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={onToggleMinimize}
              title="Minimise player"
            >
              <ChevronDownIcon size={16} />
              <span className="visually-hidden">Minimise player</span>
            </button>
          </div>
        </div>

        <div className="player-progress">
          {showProgress ? (
            <>
              <label className="visually-hidden" htmlFor="player-seek">
                Seek within the current track
              </label>
              <input
                id="player-seek"
                className="seek"
                type="range"
                min={0}
                max={Math.floor(duration)}
                step={1}
                value={Math.floor(currentTime)}
                onChange={(event) => onSeek(Number(event.target.value))}
              />
              <div className="progress-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </>
          ) : (
            <div className="progress-time">
              <span>
                {station
                  ? `${providerLabel ?? 'Live'} source · no duration reported`
                  : 'Nothing loaded'}
              </span>
              <span>—</span>
            </div>
          )}
        </div>

        {expanded && contextLabel ? (
          <div className="player-pick">
            <p className="player-pick-tag">{contextLabel}</p>
            <p className="player-pick-line">
              {contextVotes
                ? `${contextVotes} people asked for this song.`
                : 'Chosen from the community queue.'}
            </p>
            {contextHelped ? (
              <p className="player-pick-helped">You helped decide what plays next.</p>
            ) : null}
          </div>
        ) : null}

        {queueOpen ? (
          <div className="queue-pop" role="group" aria-label="Queue">
            <div className="queue-head">Up next in this station set</div>
            {queue.map((item) => (
              <button
                key={item.id}
                type="button"
                className="queue-item"
                data-current={station?.id === item.id}
                onClick={() => {
                  setQueueOpen(false);
                  onPick(item);
                }}
              >
                <img className="queue-art" src={item.artwork} alt="" loading="lazy" />
                <span>
                  <span className="queue-name">{item.name}</span>
                  <span className="queue-meta">{item.region ?? 'Archive'}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
