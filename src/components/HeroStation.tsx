import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { Visualizer } from './Visualizer';
import { PlayIcon, PauseIcon, ExternalIcon, CheckIcon, HeartIcon, ShareIcon, InfoIcon } from './Icons';

interface HeroStationProps {
  station: Station | null;
  isFavorite: boolean;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  isCurrentTrack: boolean;
  analyser: AnalyserNode | null;
  onTogglePlay: () => void;
  onOpenSource: (station: Station) => void;
  onToggleFavorite: (station: Station) => void;
  onShare: (station: Station) => void;
  onDetails: (station: Station) => void;
}

export function HeroStation({
  station,
  isFavorite,
  status,
  isCurrentTrack,
  analyser,
  onTogglePlay,
  onOpenSource,
  onToggleFavorite,
  onShare,
  onDetails,
}: HeroStationProps) {
  if (!station) {
    return (
      <section className="hero" aria-label="Active station">
        <div className="hero-card">
          <div className="hero-body">
            <p className="eyebrow">Pick a station</p>
            <h1 className="hero-title">Some places are better remembered with a song.</h1>
            <p className="hero-description">
              Choose a category, then a card from the rail below. Nothing to sign up for — the
              whole archive is already on this screen.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const decision = decideSource(station);
  const category = CATEGORY_MAP[station.category];
  const primaryLabel = labelForDecision(decision);
  const live = isCurrentTrack && status === 'playing';
  const unavailable = station.availability === 'unavailable';

  return (
    <section className="hero" aria-label="Active station">
      <div className="hero-card scanlines">
        <div className="hero-body fade-swap" key={station.id}>
          <p className="eyebrow">
            <span aria-hidden="true">{category?.icon}</span>
            {category?.label ?? station.category}
            {station.demo ? ' · sample audio' : ''}
          </p>

          <h1 className="hero-title">{station.name}</h1>
          <p className="hero-description">{station.description}</p>

          <div className="meta-strip">
            {station.region ? <span className="meta">{station.region}</span> : null}
            {station.era ? <span className="meta">{station.era}</span> : null}
            {station.language?.length ? (
              <span className="meta">{station.language.join(' · ')}</span>
            ) : null}
            {station.rating ? (
              <span className="meta meta--accent">
                ★ {station.rating.toFixed(1)}
                {station.ratingCount ? ` (${station.ratingCount})` : ''}
              </span>
            ) : null}
            {station.heat ? <span className="meta meta--accent">🔥 {station.heat}</span> : null}
            <span className="meta">{unavailable ? 'Source flagged' : station.sourceType}</span>
          </div>

          <div className="hero-actions">
            {decision.kind === 'play' ? (
              <button type="button" className="btn btn--primary" onClick={onTogglePlay}>
                {status === 'loading' ? (
                  'Loading…'
                ) : live ? (
                  <>
                    <PauseIcon size={16} /> Pause
                  </>
                ) : (
                  <>
                    <PlayIcon size={16} /> Play
                  </>
                )}
              </button>
            ) : decision.kind === 'blocked' ? (
              <button type="button" className="btn btn--muted" disabled>
                Unavailable
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => onOpenSource(station)}
              >
                {decision.kind === 'check' ? <CheckIcon size={15} /> : <ExternalIcon size={15} />}
                {primaryLabel}
              </button>
            )}

            <button
              type="button"
              className="btn btn--muted"
              onClick={() => onOpenSource(station)}
              title="Open the station's own page in a new tab"
            >
              <ExternalIcon size={15} /> Enter station
            </button>

            <button
              type="button"
              className="btn round-btn"
              aria-pressed={isFavorite}
              aria-label={isFavorite ? 'Remove from my stations' : 'Save to my stations'}
              onClick={() => onToggleFavorite(station)}
            >
              <HeartIcon filled={isFavorite} size={17} />
            </button>

            <button
              type="button"
              className="btn round-btn"
              aria-label="Share this sound"
              onClick={() => onShare(station)}
            >
              <ShareIcon size={17} />
            </button>

            <button
              type="button"
              className="btn round-btn"
              aria-label="Station details"
              onClick={() => onDetails(station)}
            >
              <InfoIcon size={17} />
            </button>
          </div>
        </div>

        <div className="deck" aria-hidden="true">
          <div className={`cassette ${live ? 'is-spinning' : ''}`}>
            <span className="cassette-label">
              {station.name} — {station.era ?? 'archive'}
            </span>
            <div className="cassette-window">
              <span className="reel" />
              <span className="reel" />
            </div>
            <span className="cassette-strip" />
          </div>

          <div className="deck-footer">
            <span className="on-air" data-live={live}>
              <span className="dot" />
              {live ? 'On air' : status === 'error' ? 'Signal lost' : 'Standby'}
            </span>
            <Visualizer analyser={analyser} active={live} />
          </div>
        </div>
      </div>
    </section>
  );
}
