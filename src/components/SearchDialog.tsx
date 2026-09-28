import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Station } from '../types/station';
import { CATEGORY_MAP } from '../data/categories';
import { searchStations } from '../lib/catalog';
import { decideSource } from '../lib/sourcePolicy';
import { CloseIcon, SearchIcon, ShuffleIcon } from './Icons';

interface SearchDialogProps {
  open: boolean;
  favorites: Station[];
  showFavorites: boolean;
  onClose: () => void;
  onPick: (station: Station) => void;
  onSurprise: () => void;
}

/** Local dataset search. No API request, no telemetry, no recent-search server. */
export function SearchDialog({
  open,
  favorites,
  showFavorites,
  onClose,
  onPick,
  onSurprise,
}: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after paint so the dialog is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    if (showFavorites) return favorites;
    if (!query.trim()) return [];
    return searchStations(query);
  }, [query, showFavorites, favorites]);

  if (!open) return null;

  const pick = (station: Station) => {
    onPick(station);
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const station = results[active];
      if (station) pick(station);
    }
  };

  const heading = showFavorites
    ? 'My stations'
    : query.trim()
      ? `${results.length} match${results.length === 1 ? '' : 'es'}`
      : 'Search the archive';

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={heading}>
        <div className="dialog-input">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search a place, mood, language or memory…"
            aria-label="Search stations"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="results" role="listbox" aria-label={heading}>
          {results.length === 0 ? (
            <p className="empty" style={{ margin: 'var(--space-3)' }}>
              {showFavorites
                ? 'Tap ♡ to save a station on this device.'
                : 'Try a place, language, mood or category — for example “Bihar”, “folk” or “chai”.'}
            </p>
          ) : (
            results.map((station, index) => {
              const decision = decideSource(station);
              const category = CATEGORY_MAP[station.category];
              return (
                <button
                  key={station.id}
                  type="button"
                  className="result"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(station)}
                >
                  <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="result-name">{station.name}</span>
                    <br />
                    <span className="result-meta">
                      {category?.label} · {station.region ?? 'Archive'} · {station.era ?? '—'}
                    </span>
                  </span>
                  <span className="result-meta">
                    {decision.kind === 'play' ? 'Play' : decision.kind === 'check' ? 'Check' : 'Open'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="dialog-foot">
          <span>↑ ↓ move</span>
          <span>Enter select</span>
          <span>Esc close</span>
          <button type="button" className="card-action" onClick={onSurprise}>
            <ShuffleIcon size={11} /> Surprise me
          </button>
        </div>
      </div>
    </div>
  );
}
