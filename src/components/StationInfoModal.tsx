import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { classifyUrl } from '../lib/urlSafety';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { CloseIcon, ExternalIcon, ShareIcon } from './Icons';

interface StationInfoModalProps {
  station: Station | null;
  onClose: () => void;
  onShare: (station: Station) => void;
  onOpenSource: (station: Station) => void;
}

/** Station details as a modal (bottom sheet on mobile) — never a page route. */
export function StationInfoModal({
  station,
  onClose,
  onShare,
  onOpenSource,
}: StationInfoModalProps) {
  if (!station) return null;

  const decision = decideSource(station);
  const category = CATEGORY_MAP[station.category];
  const urlSafety = classifyUrl(station.url);
  const external = station.externalLinks ?? [];

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="station-modal-title">
        <div className="modal-body">
          <div className="modal-head">
            <p className="eyebrow">
              {category?.icon} {category?.label}
            </p>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
              <CloseIcon size={16} />
            </button>
          </div>

          <img
            className="modal-art"
            src={station.artwork}
            alt={`${station.name} — atmospheric station artwork`}
            decoding="async"
          />

          <h2 className="modal-title" id="station-modal-title">
            {station.name}
          </h2>
          <p className="modal-desc">{station.description}</p>

          <dl className="modal-list">
            <dt>Region</dt>
            <dd>{station.region ?? '—'}</dd>
            <dt>Era</dt>
            <dd>{station.era ?? '—'}</dd>
            <dt>Languages</dt>
            <dd>{station.language?.join(', ') ?? '—'}</dd>
            <dt>Source</dt>
            <dd>
              {station.sourceType} · {labelForDecision(decision)}
            </dd>
            <dt>URL safety</dt>
            <dd>{urlSafety === 'unsafe' ? 'Rejected' : 'Validated http(s)'}</dd>
            <dt>Status</dt>
            <dd>{station.status ?? 'ready'}</dd>
          </dl>

          <div className="modal-actions">
            <button type="button" className="link-chip" onClick={() => onOpenSource(station)}>
              <ExternalIcon size={14} /> Source page
            </button>

            {external.map((link) => (
              <a
                key={link.url}
                className="link-chip"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalIcon size={14} /> {link.label}
              </a>
            ))}

            <button type="button" className="link-chip" onClick={() => onShare(station)}>
              <ShareIcon size={14} /> Share
            </button>
          </div>

          <p className="footer-note" style={{ marginTop: 'var(--space-5)' }}>
            External links open in a new tab without opener access. Nothing here tracks you, and no
            account or database exists — everything runs in your browser.
          </p>
        </div>
      </div>
    </div>
  );
}
