import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Station } from '../types/station';
import { getCategory } from '../lib/live-catalogue';
import { useLiveCatalogue } from '../hooks/useLiveCatalogue';
import { searchStations } from '../lib/catalog';
import { decideSource, isPlayableDecision } from '../lib/sourcePolicy';
import { CloseIcon, SearchIcon, ShuffleIcon } from './Icons';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onPick: (station: Station) => void;
  onSurprise: () => void;
}

/** Minimal overlay search over the local dataset — no API request, no telemetry. */
export function SearchOverlay({ open, onClose, onPick, onSurprise }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Subscribes to the live catalogue so results never lag behind admin edits.
  useLiveCatalogue();

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // No memo: the search runs over the (tiny) live snapshot, so an admin edit
  // is reflected the moment this overlay re-renders.
  const results = query.trim() ? searchStations(query) : [];

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

  const heading = query.trim()
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
              Try a place, language, mood or category — for example “Bihar”, “folk” or “chai”.
            </p>
          ) : (
            results.map((station, index) => {
              const decision = decideSource(station);
              const category = getCategory(station.category);
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
                  <img className="result-art" src={station.artwork} alt="" loading="lazy" />
                  <span>
                    <span className="result-name">{station.name}</span>
                    <span className="result-meta">
                      {category?.shortLabel} · {station.region ?? 'Archive'} · {station.era ?? '—'}
                    </span>
                  </span>
                  <span className="result-meta">
                    {isPlayableDecision(decision)
                      ? 'Play'
                      : decision.kind === 'check'
                        ? 'Check'
                        : 'Open'}
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
          <button type="button" className="link-chip" onClick={onSurprise}>
            <ShuffleIcon size={12} /> Surprise me
          </button>
        </div>
      </div>
    </div>
  );
}
