import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';

interface NowPlayingProps {
  station: Station | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  isCurrentTrack: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  onSeek: (seconds: number) => void;
  onOpenSource: (station: Station) => void;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const statusCopy: Record<NowPlayingProps['status'], { label: string; tone: string }> = {
  idle: { label: 'Nothing loaded', tone: 'idle' },
  loading: { label: 'Tuning in…', tone: 'idle' },
  playing: { label: 'Playing', tone: 'live' },
  paused: { label: 'Paused', tone: 'idle' },
  error: { label: 'Signal problem', tone: 'error' },
};

export function NowPlaying({
  station,
  status,
  isCurrentTrack,
  currentTime,
  duration,
  error,
  onSeek,
  onOpenSource,
}: NowPlayingProps) {
  const copy = statusCopy[status];
  const effectiveStatus = isCurrentTrack ? status : 'idle';
  const shown = statusCopy[effectiveStatus];
  const category = station ? CATEGORY_MAP[station.category] : null;

  return (
    <aside className="now-playing" aria-label="Now playing">
      <div className="panel">
        <h2 className="panel-title">Now playing</h2>

        {!station ? (
          <p className="np-empty">
            Nothing loaded. Pick a station and press play — the deck stays here all session.
          </p>
        ) : (
          <div className="fade-swap" key={station.id}>
            <p className="np-station">{station.name}</p>
            <p className="np-description">
              {category?.label} · {station.region ?? 'Archive'}
            </p>

            <div className="status-line" data-tone={shown.tone} role="status">
              <span aria-hidden="true">●</span>
              {shown.label}
              {station.demo ? ' · sample audio' : ''}
            </div>

            {error && isCurrentTrack ? (
              <p className="np-description" role="alert" style={{ color: 'var(--danger)' }}>
                {error}{' '}
                <button
                  type="button"
                  className="card-action"
                  onClick={() => onOpenSource(station)}
                >
                  Open station
                </button>
              </p>
            ) : null}

            <div className="progress">
              <label className="visually-hidden" htmlFor="seek">
                Seek within the current track
              </label>
              <input
                id="seek"
                className="seek"
                type="range"
                min={0}
                max={duration > 0 ? Math.floor(duration) : 0}
                step={1}
                value={Math.floor(currentTime)}
                disabled={!isCurrentTrack || duration <= 0}
                onChange={(event) => onSeek(Number(event.target.value))}
              />
              <div className="progress-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <span className="visually-hidden">{copy.label}</span>
    </aside>
  );
}
