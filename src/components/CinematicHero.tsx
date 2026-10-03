import type { CategoryId, Station } from '../types/station';
import { decideSource, isPlayableDecision, labelForDecision } from '../lib/sourcePolicy';
import { sessionBackdrop } from '../lib/backdrop';
import { heroEyebrow, heroMeta, heroTitle } from '../lib/hero';
import { PlayIcon, PauseIcon, ShareIcon, InfoIcon, LoadingIcon, PinIcon, ShuffleIcon } from './Icons';
import { StationGallery } from './StationGallery';

export type PlayerState = 'ready' | 'buffering' | 'playing' | 'paused' | 'offline' | 'error';

interface CinematicHeroProps {
  station: Station | null;
  playerState: PlayerState;
  isCurrentTrack: boolean;
  /**
   * Channel-scope CTA override ("Listen live" / "Pause"). Undefined = the
   * station's own decision label — the classic local-tune behaviour.
   */
  primaryLabel?: string;
  /** Category the gallery should mark as active. */
  activeCategory: CategoryId;
  /** Approximate live sessions from the presence channel; null until known. */
  listeners: number | null;
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
  buffering: 'Loading',
  playing: 'On air',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Error',
};

const badgeState = (state: PlayerState, current: boolean): PlayerState => {
  if (state === 'offline' || state === 'error') return state;
  return current ? state : 'ready';
};

export function CinematicHero({
  station,
  playerState,
  isCurrentTrack,
  primaryLabel,
  activeCategory,
  listeners,
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
  // One backdrop per station per page load — reloads draw a new stage.
  const stage = sessionBackdrop(station) ?? station.artwork;
  const isPhoto = stage !== station.artwork;
  const [line1, line2] = heroTitle(station);
  const meta = heroMeta(station);
  const state = badgeState(playerState, isCurrentTrack);
  const playingNow = isCurrentTrack && playerState === 'playing';
  const buffering = isCurrentTrack && playerState === 'buffering';

  const ctaLabel = primaryLabel ?? (playingNow ? 'Pause' : labelForDecision(decision));

  return (
    <section className="hero" aria-label={`Featured station: ${station.name}`}>
      {/* The stage photo is the page's LCP — fetch it at high priority.
          React 18 passes the lowercase attribute straight to the DOM. */}
      <img
        className="hero-art"
        key={stage}
        src={stage}
        alt={isPhoto ? '' : `${station.name} — cinematic station artwork`}
        decoding="async"
        {...({ fetchpriority: 'high' } as Record<string, string>)}
      />
      <div className="hero-scrim" />
      <div className="hero-glow" aria-hidden="true" />

      <span className="live-badge" data-state={state}>
        <span className="dot" aria-hidden="true" />
        {badgeCopy[state]}
        {/* Real sessions only — nothing renders until the channel answers.
            The key restarts the count-in animation exactly when the number
            changes, and never otherwise. */}
        {listeners ? (
          <span className="live-count" key={listeners}>
            {listeners} listening
          </span>
        ) : null}
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
              {isPlayableDecision(decision) ? null : <span>Source page</span>}
            </div>

            <div className="hero-actions">
              <button
                type="button"
                className={`cta ${isPlayableDecision(decision) ? 'cta--primary' : 'cta--secondary'}`}
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
                {ctaLabel}
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
