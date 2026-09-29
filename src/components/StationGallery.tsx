import { CATEGORIES } from '../data/categories';
import { STATIONS } from '../data/stations';
import { findStation, stationsForCategory } from '../lib/catalog';
import { heroMeta } from '../lib/hero';
import type { CategoryId } from '../types/station';

interface StationGalleryProps {
  /** The category the hero currently speaks for. */
  activeCategory: CategoryId;
  /** True while the hero station is actually audible. */
  live: boolean;
  onSelect: (id: CategoryId) => void;
  /** Opens the full station list — the gallery never grows into a sidebar. */
  onExploreAll: () => void;
}

/**
 * The right side of the hero: eight miniature posters, one per listening world.
 * Pressing one re-tunes the same screen (artwork, title, copy, accent, track) —
 * it never navigates, and it never turns into a scrolling dashboard.
 */
export function StationGallery({
  activeCategory,
  live,
  onSelect,
  onExploreAll,
}: StationGalleryProps) {
  return (
    <div className="gallery" role="group" aria-label="Radio categories">
      <div className="gallery-head">
        <p className="gallery-eyebrow">Explore the radio</p>
        <p className="gallery-count">{STATIONS.length} stations</p>
      </div>

      <div className="station-grid">
        {CATEGORIES.map((category) => {
          const flagship = findStation(category.flagship);
          const isActive = category.id === activeCategory;
          const count = stationsForCategory(category.id).length;
          const status = isActive ? (live ? 'On air' : 'Ready') : `${count} stations`;

          return (
            <button
              key={category.id}
              type="button"
              className="station-card"
              data-active={isActive ? 'true' : undefined}
              data-live={isActive && live ? 'true' : undefined}
              aria-pressed={isActive}
              onClick={() => onSelect(category.id)}
              title={
                flagship
                  ? `${category.label} — tunes into ${flagship.name}`
                  : `${category.label} category`
              }
            >
              {flagship ? (
                <img
                  className="station-card-art"
                  src={flagship.artwork}
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                />
              ) : null}
              <span className="station-card-scrim" aria-hidden="true" />

              <span className="station-card-status">
                <span className="dot" aria-hidden="true" />
                {status}
              </span>

              <span className="station-card-body">
                <span className="station-card-name">{category.label}</span>
                <span className="station-card-tag">{category.tagline}</span>
                <span className="station-card-meta">
                  {flagship ? heroMeta(flagship).join(' · ') : category.shortLabel}
                </span>
              </span>

              <span className="station-card-arrow" aria-hidden="true">
                →
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="gallery-more" onClick={onExploreAll}>
        Explore all stations <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
