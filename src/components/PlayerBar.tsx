import type { Station } from '../types/station';
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  VolumeIcon,
  MuteIcon,
  SearchIcon,
} from './Icons';

interface PlayerBarProps {
  station: Station | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  isCurrentTrack: boolean;
  volume: number;
  muted: boolean;
  canPlay: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onOpenSearch: () => void;
}

export function PlayerBar({
  station,
  status,
  isCurrentTrack,
  volume,
  muted,
  canPlay,
  onPrevious,
  onNext,
  onTogglePlay,
  onVolume,
  onToggleMute,
  onOpenSearch,
}: PlayerBarProps) {
  const live = isCurrentTrack && status === 'playing';
  const loading = isCurrentTrack && status === 'loading';

  return (
    <footer className="player" aria-label="Player controls">
      <div className="player-controls">
        <button type="button" className="icon-btn" onClick={onPrevious} title="Previous station">
          <PrevIcon size={16} />
          <span className="visually-hidden">Previous station</span>
        </button>

        <button
          type="button"
          className="play-btn"
          onClick={onTogglePlay}
          disabled={!canPlay}
          title="Play / pause (Space)"
        >
          {loading ? '…' : live ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          <span className="visually-hidden">{live ? 'Pause' : 'Play'}</span>
        </button>

        <button type="button" className="icon-btn" onClick={onNext} title="Next station">
          <NextIcon size={16} />
          <span className="visually-hidden">Next station</span>
        </button>
      </div>

      <div className="player-meta">
        <div className="player-station">{station ? station.name : 'No station selected'}</div>
        <div className="player-sub">
          {station
            ? loading
              ? 'Tuning in…'
              : live
                ? 'On air · sample or licensed stream'
                : station.availability === 'unavailable'
                  ? 'Source flagged · check station'
                  : 'Ready'
            : 'Choose a card below'}
        </div>
      </div>

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
        <label className="visually-hidden" htmlFor="volume">
          Volume
        </label>
        <input
          id="volume"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(volume * 100)}
          onChange={(event) => onVolume(Number(event.target.value) / 100)}
        />
      </div>

      <div className="player-hint">
        <button type="button" className="icon-btn" onClick={onOpenSearch} title="Search (press /)">
          <SearchIcon size={16} />
          <span className="visually-hidden">Search</span>
        </button>
        <span className="kbd">/</span>
        <span className="kbd">Space</span>
        <span className="kbd">← →</span>
      </div>
    </footer>
  );
}
