import type { Station } from '../types/station';
import { decideSource } from '../lib/sourcePolicy';
import type { PlayerState } from './CinematicHero';
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  VolumeIcon,
  MuteIcon,
  ExternalIcon,
  ChevronUpIcon,
  ChevronDownIcon,
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
  expanded: boolean;
  onToggleExpand: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onSeek: (seconds: number) => void;
  onOpenSource: (station: Station) => void;
}

const stateCopy: Record<PlayerState, string> = {
  ready: 'Ready',
  buffering: 'Buffering',
  playing: 'Playing',
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
 * One compact player for every breakpoint.
 * Desktop: floating glass bar over the lower viewport.
 * Mobile: compact fixed bar that expands into a bottom sheet.
 * Progress only appears when real duration data exists — never simulated.
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
  expanded,
  onToggleExpand,
  onPrevious,
  onNext,
  onTogglePlay,
  onVolume,
  onToggleMute,
  onSeek,
  onOpenSource,
}: FloatingPlayerProps) {
  const state: PlayerState = isCurrentTrack ? playerState : station ? 'ready' : 'ready';
  const live = state === 'playing';
  const showProgress = isCurrentTrack && duration > 0;
  const decision = station ? decideSource(station) : null;

  return (
    <div className="player" data-expanded={expanded} aria-label="Player controls" role="group">
      <div className="player-main">
        {station ? (
          <img className="player-art" src={station.artwork} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="player-art" aria-hidden="true" />
        )}

        <div className="player-meta">
          <div className="player-title">{station ? station.name : 'No station selected'}</div>
          <div className="player-sub" data-state={state}>
            <span className="dot" aria-hidden="true" />
            {stateCopy[state]}
            {station?.demo && live ? ' · sample audio' : ''}
            {!station ? ' · pick a station' : ''}
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

          <button type="button" className="icon-btn player-step" onClick={onNext} title="Next station">
            <NextIcon size={16} />
            <span className="visually-hidden">Next station</span>
          </button>

          <button
            type="button"
            className="icon-btn player-expand"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            title={expanded ? 'Collapse player' : 'Expand player'}
          >
            {expanded ? <ChevronDownIcon size={18} /> : <ChevronUpIcon size={18} />}
            <span className="visually-hidden">{expanded ? 'Collapse player' : 'Expand player'}</span>
          </button>
        </div>
      </div>

      <div className="player-more">
        {showProgress ? (
          <div className="player-progress">
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
          </div>
        ) : (
          <div className="player-progress">
            <div className="progress-time">
              <span>{station ? 'Live source · no duration reported' : 'Nothing loaded'}</span>
            </div>
          </div>
        )}

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

        {station && decision && decision.kind !== 'blocked' ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onOpenSource(station)}
            title="Open the station's own page"
          >
            <ExternalIcon size={16} />
            <span className="visually-hidden">Open the station’s own page</span>
          </button>
        ) : null}

        <div className="player-hint">
          <span className="kbd">Space</span>
          <span className="kbd">/</span>
          <span className="kbd">← →</span>
        </div>
      </div>
    </div>
  );
}
