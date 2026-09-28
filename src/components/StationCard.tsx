import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { decideSource, labelForDecision } from '../lib/sourcePolicy';
import { PlayIcon, ExternalIcon, CheckIcon } from './Icons';

interface StationCardProps {
  station: Station;
  index: number;
  selected: boolean;
  playing: boolean;
  isFavorite: boolean;
  onSelect: (station: Station) => void;
  onPrimary: (station: Station) => void;
}

const initials = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

export function StationCard({
  station,
  index,
  selected,
  playing,
  isFavorite,
  onSelect,
  onPrimary,
}: StationCardProps) {
  const decision = decideSource(station);
  const label = labelForDecision(decision);
  const unavailable = station.availability === 'unavailable';
  const category = CATEGORY_MAP[station.category];

  return (
    <div
      className="card"
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-current={selected}
      data-available={!unavailable}
      onClick={() => onSelect(station)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(station);
        }
      }}
    >
      <div className="card-top">
        <span className="card-index">
          {String(index + 1).padStart(2, '0')} · {category?.label ?? station.category}
        </span>
        {playing ? (
          <span className="badge-live">
            <span className="dot" /> On air
          </span>
        ) : (
          <span aria-hidden="true">{unavailable ? 'Check' : 'Ready'}</span>
        )}
      </div>

      <div className="card-art" aria-hidden="true">
        {initials(station.name)}
      </div>

      <div>
        <p className="card-name">{station.name}</p>
        <p className="card-desc">{station.description}</p>
      </div>

      <div className="card-foot">
        <span>
          {station.region ?? '—'}
          {station.rating ? ` · ★${station.rating.toFixed(1)}` : ''}
          {station.heat ? ` · 🔥${station.heat}` : ''}
        </span>
        <button
          type="button"
          className="card-action"
          data-tone={decision.kind === 'check' ? 'check' : 'play'}
          onClick={(event) => {
            event.stopPropagation();
            onPrimary(station);
          }}
        >
          {decision.kind === 'play' ? <PlayIcon size={12} /> : null}
          {decision.kind === 'check' ? <CheckIcon size={12} /> : null}
          {decision.kind === 'open' ? <ExternalIcon size={12} /> : null}
          {decision.kind === 'blocked' ? '—' : label}
          <span className="visually-hidden"> {station.name}</span>
        </button>
      </div>

      {isFavorite ? (
        <span className="visually-hidden">Saved to my stations</span>
      ) : null}
    </div>
  );
}
