import type { CategoryId, Station } from '../types/station';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { heroEyebrow, heroMeta, heroTitle } from '../lib/hero';
import { PlayIcon, PauseIcon, ShareIcon, InfoIcon, LoadingIcon, PinIcon, ShuffleIcon } from './Icons';
import { StationGallery } from './StationGallery';

export type PlayerState = 'ready' | 'buffering' | 'playing' | 'paused' | 'offline' | 'error';

interface CinematicHeroProps {
  station: Station | null;
  playerState: PlayerState;
  isCurrentTrack: boolean;
  /** Category the gallery should mark as active. */
  activeCategory: CategoryId;
  onPrimary: () => void;
  onShare: () => void;
  onInfo: () => void;
  onSurprise: () => void;
  onSelectCategory: (id: CategoryId) => void;
  onExploreAll: () => void;
}

/** Non-numeric station flavour — this is a radio badge, not an analytics widget. */
const badgeCopy: Record<PlayerState, string> = {
  ready: 'Ready',
  buffering: 'Tuning in',
  playing: 'On air',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Signal problem',
};

const badgeState = (state: PlayerState, current: boolean): PlayerState => {
  if (state === 'offline' || state === 'error') return state;
  return current ? state : 'ready';
};

export function CinematicHero({
  station,
  playerState,
  isCurrentTrack,
  activeCategory,
  onPrimary,
  onShare,
  onInfo,
  onSurprise,
  onSelectCategory,
  onExploreAll,
}: CinematicHeroProps) {
  const live = isCurrentTrack && playerState === 'playing';
  const gallery = (
    <StationGallery
      activeCategory={activeCategory}
      live={live}
      onSelect={onSelectCategory}
      onExploreAll={onExploreAll}
    />
  );

  if (!station) {
    return (
      <section className="hero" aria-label="Nostalgia Radio">
        <div className="hero-scrim" />
        <div className="hero-content wrap">
          <div className="hero-cols">
            <div className="hero-fade">
              <p className="eyebrow">Nostalgia Radio</p>
              <h1 className="hero-title">
                Some places are better
                <span className="line-2">remembered with a song.</span>
              </h1>
              <p className="hero-description">
                Pick a station in the gallery and press play — no account, no catalogue, just the
                old roads.
              </p>
            </div>
            {gallery}
          </div>
        </div>
      </section>
    );
  }

  const decision = decideSource(station);
  const [line1, line2] = heroTitle(station);
  const meta = heroMeta(station);
  const state = badgeState(playerState, isCurrentTrack);
  const playingNow = isCurrentTrack && playerState === 'playing';
  const buffering = isCurrentTrack && playerState === 'buffering';

  const primaryLabel =
    playingNow ? 'Pause' : decision.kind === 'play' ? 'Play' : labelForDecision(decision);

  return (
    <section className="hero" aria-label={`Featured station: ${station.name}`}>
      <img
        className="hero-art"
        key={station.artwork}
        src={station.artwork}
        alt={`${station.name} — cinematic station artwork`}
        decoding="async"
      />
      <div className="hero-scrim" />

      <span className="live-badge" data-state={state}>
        <span className="dot" aria-hidden="true" />
        {badgeCopy[state]}
      </span>

      <div className="hero-content wrap">
        <div className="hero-cols">
          <div className="hero-fade" key={`${station.id}-content`}>
            <p className="eyebrow">{heroEyebrow(station)}</p>

            <h1 className="hero-title">
              {line1}
              {line2 ? <span className="line-2">{line2}</span> : null}
            </h1>

            <p className="hero-description">{station.description}</p>

            <div className="meta-strip">
              <span>
                <PinIcon size={13} />
                {meta.join(' · ')}
              </span>
              {station.demo ? <span>Sample audio</span> : null}
              {decision.kind === 'play' ? null : <span>Source page</span>}
            </div>

            <div className="hero-actions">
              <button
                type="button"
                className={`cta ${decision.kind === 'play' ? 'cta--primary' : 'cta--secondary'}`}
                onClick={onPrimary}
                disabled={decision.kind === 'blocked'}
              >
                {buffering ? (
                  <LoadingIcon size={16} />
                ) : playingNow ? (
                  <PauseIcon size={16} />
                ) : (
                  <PlayIcon size={16} />
                )}
                {primaryLabel}
              </button>

              <button type="button" className="surprise-btn" onClick={onSurprise} title="Surprise me (R)">
                <ShuffleIcon size={15} />
                <span>Surprise me</span>
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
            </div>
          </div>

          {gallery}
        </div>
      </div>

      <div className="hero-hints" aria-hidden="true">
        <span>
          <span className="kbd">Space</span>Play / Pause
        </span>
        <span>
          <span className="kbd">← →</span>Seek / Station
        </span>
        <span>
          <span className="kbd">M</span>Mute
        </span>
        <span>
          <span className="kbd">S</span>Share
        </span>
        <span>
          <span className="kbd">?</span>Help
        </span>
      </div>
    </section>
  );
}
