import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { classifyUrl } from '../lib/urlSafety';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { CloseIcon, ExternalIcon, HeartIcon, ShareIcon } from './Icons';

interface StationDrawerProps {
  station: Station | null;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: (station: Station) => void;
  onShare: (station: Station) => void;
  onOpenSource: (station: Station) => void;
}

/** Overlay detail sheet — never pushes page scroll on the single screen. */
export function StationDrawer({
  station,
  isFavorite,
  onClose,
  onToggleFavorite,
  onShare,
  onOpenSource,
}: StationDrawerProps) {
  if (!station) return null;

  const decision = decideSource(station);
  const category = CATEGORY_MAP[station.category];
  const urlSafety = classifyUrl(station.url);

  return (
    <div
      className="drawer-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow">{category?.icon} {category?.label}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <CloseIcon size={16} />
          </button>
        </div>

        <h2 id="drawer-title">{station.name}</h2>
        <p className="hero-description">{station.description}</p>

        <dl style={{ marginTop: 'var(--space-5)' }}>
          <dt>Region</dt>
          <dd>{station.region ?? '—'}</dd>
          <dt>Era</dt>
          <dd>{station.era ?? '—'}</dd>
          <dt>Languages</dt>
          <dd>{station.language?.join(', ') ?? '—'}</dd>
          <dt>Tags</dt>
          <dd>{station.tags?.join(', ') ?? '—'}</dd>
          <dt>Source</dt>
          <dd>
            {station.sourceType} · {labelForDecision(decision)}
          </dd>
          <dt>URL safety</dt>
          <dd>{urlSafety === 'unsafe' ? 'Rejected' : 'Validated http(s)'}</dd>
          <dt>Availability</dt>
          <dd>{station.availability ?? 'available'}</dd>
        </dl>

        <p className="np-description" style={{ marginTop: 'var(--space-4)' }}>
          External links open in a new tab without opener access. Nothing here tracks you, and
          favourites stay on this device.
        </p>

        <div className="drawer-actions">
          <button type="button" className="btn btn--ghost" onClick={() => onOpenSource(station)}>
            <ExternalIcon size={15} /> Open source
          </button>
          <button
            type="button"
            className="btn btn--muted"
            aria-pressed={isFavorite}
            onClick={() => onToggleFavorite(station)}
          >
            <HeartIcon size={15} filled={isFavorite} />{' '}
            {isFavorite ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="btn btn--muted" onClick={() => onShare(station)}>
            <ShareIcon size={15} /> Share
          </button>
        </div>
      </div>
    </div>
  );
}
