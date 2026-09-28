import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { PlayIcon, ExternalIcon, CheckIcon } from './Icons';

interface StationCardProps {
  station: Station;
  selected: boolean;
  playing: boolean;
  onSelect: (station: Station) => void;
  onPrimary: (station: Station) => void;
}

export function StationCard({ station, selected, playing, onSelect, onPrimary }: StationCardProps) {
  const decision = decideSource(station);
  const label = labelForDecision(decision);
  const offline = station.status === 'offline' || station.status === 'unknown';
  const category = CATEGORY_MAP[station.category];
  const meta = [station.region ?? 'Archive', station.era].filter(Boolean).join(' · ');

  return (
    <article
      className="card"
      data-selected={selected}
      data-status={offline ? 'offline' : 'ready'}
      tabIndex={0}
      aria-label={`${station.name}. ${station.description}`}
      onClick={() => onSelect(station)}
      onKeyDown={(event) => {
        // Enter selects; Space is left to the global play/pause shortcut.
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(station);
        }
      }}
    >
      <div className="card-art">
        <img
          src={station.artwork}
          alt={`${station.name} — atmospheric station artwork`}
          loading="lazy"
          decoding="async"
        />
        <span className="card-status">{offline ? 'Check' : playing ? 'On air' : 'Ready'}</span>
      </div>

      <div className="card-body">
        <h3 className="card-title">{station.name}</h3>
        <p className="card-desc">{station.description}</p>

        <div className="card-foot">
          <span className="card-meta">
            {category?.shortLabel} · {meta}
          </span>
          <button
            type="button"
            className="card-play"
            data-tone={decision.kind === 'check' ? 'check' : 'play'}
            onClick={(event) => {
              event.stopPropagation();
              onPrimary(station);
            }}
          >
            {decision.kind === 'play' ? (
              <PlayIcon size={12} />
            ) : decision.kind === 'check' ? (
              <CheckIcon size={12} />
            ) : (
              <ExternalIcon size={12} />
            )}
            {label}
            <span className="visually-hidden"> — {station.name}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
