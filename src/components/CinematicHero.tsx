import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { PlayIcon, PauseIcon, ShareIcon, InfoIcon, LoadingIcon } from './Icons';

export type PlayerState = 'ready' | 'buffering' | 'playing' | 'paused' | 'offline' | 'error';

interface CinematicHeroProps {
  station: Station | null;
  playerState: PlayerState;
  isCurrentTrack: boolean;
  onPrimary: () => void;
  onShare: () => void;
  onInfo: () => void;
}

const stateCopy: Record<PlayerState, string> = {
  ready: 'Ready',
  buffering: 'Buffering',
  playing: 'On air',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Signal problem',
};

const heroState = (station: Station | null, state: PlayerState, current: boolean): PlayerState => {
  if (!station) return 'ready';
  if (state === 'offline' || state === 'error') return state;
  return current ? state : 'ready';
};

export function CinematicHero({
  station,
  playerState,
  isCurrentTrack,
  onPrimary,
  onShare,
  onInfo,
}: CinematicHeroProps) {
  if (!station) {
    return (
      <section className="hero" aria-label="Now featured">
        <div className="hero-scrim" />
        <div className="hero-content wrap">
          <p className="eyebrow">Nostalgia Radio</p>
          <h1 className="hero-title">Some places are better remembered with a song.</h1>
          <p className="hero-description">
            Pick a category above and press play. No account, no catalogue — one screen of stations
            from the old roads.
          </p>
        </div>
      </section>
    );
  }

  const decision = decideSource(station);
  const category = CATEGORY_MAP[station.category];
  const offline = station.status === 'offline' || station.status === 'unknown';
  const showState = heroState(station, playerState, isCurrentTrack);

  const primaryLabel =
    decision.kind === 'play' ? 'Play' : labelForDecision(decision);

  const artworkAlt = `${station.name} — ${station.region ?? 'nostalgia'} scene`;

  return (
    <section className="hero" aria-label={`Featured station: ${station.name}`}>
      <img
        className="hero-art"
        key={station.artwork}
        src={station.artwork}
        alt={artworkAlt}
        decoding="async"
      />
      <div className="hero-scrim" />

      <div className="hero-content wrap" key={`${station.id}-content`}>
        <div className="hero-fade">
          <p className="eyebrow">
            {category?.icon} {category?.label ?? station.category}
            {station.demo ? ' · sample audio' : ''}
          </p>

          <h1 className="hero-title">{station.name}</h1>
          <p className="hero-description">{station.description}</p>

          <div className="meta-strip">
            {station.region ? <span>{station.region}</span> : null}
            {station.era ? <span>{station.era}</span> : null}
            {station.language?.length ? <span>{station.language.join(' · ')}</span> : null}
            <span>{offline ? 'Check source' : decision.kind === 'play' ? 'Streaming' : 'Source page'}</span>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className={`cta ${decision.kind === 'play' ? 'cta--primary' : 'cta--secondary'}`}
              onClick={onPrimary}
              disabled={decision.kind === 'blocked'}
            >
              {playerState === 'buffering' && isCurrentTrack ? (
                <LoadingIcon size={16} />
              ) : isCurrentTrack && playerState === 'playing' ? (
                <PauseIcon size={16} />
              ) : (
                <PlayIcon size={16} />
              )}
              {isCurrentTrack && playerState === 'playing' ? 'Pause' : primaryLabel}
            </button>

            <div className="hero-utility">
              <button type="button" className="icon-btn" onClick={onShare} title="Share this station">
                <ShareIcon />
                <span className="visually-hidden">Share this station</span>
              </button>
              <button type="button" className="icon-btn" onClick={onInfo} title="Station details">
                <InfoIcon />
                <span className="visually-hidden">Station details</span>
              </button>
            </div>

            <span className="hero-status" data-state={showState}>
              <span className="dot" aria-hidden="true" />
              {stateCopy[showState]}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
