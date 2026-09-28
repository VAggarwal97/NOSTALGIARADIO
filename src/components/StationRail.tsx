import type { Station } from '../types/station';
import { StationCard } from './StationCard';

interface StationRailProps {
  stations: Station[];
  selectedId: string | null;
  playingId: string | null;
  favoriteIds: string[];
  title: string;
  hint?: string;
  emptyMessage?: string;
  onSelect: (station: Station) => void;
  onPrimary: (station: Station) => void;
}

export function StationRail({
  stations,
  selectedId,
  playingId,
  favoriteIds,
  title,
  hint,
  emptyMessage,
  onSelect,
  onPrimary,
}: StationRailProps) {
  return (
    <section className="rail-region" aria-labelledby="rail-title">
      <div className="rail-head">
        <h2 className="rail-title" id="rail-title">
          {title}
        </h2>
        {hint ? <span className="rail-hint">{hint}</span> : null}
      </div>

      {stations.length === 0 ? (
        <p className="empty">{emptyMessage ?? 'No stations in this category yet.'}</p>
      ) : (
        <div className="rail" id="station-rail" role="listbox" aria-label={title} tabIndex={-1}>
          {stations.map((station, index) => (
            <StationCard
              key={station.id}
              station={station}
              index={index}
              selected={station.id === selectedId}
              playing={station.id === playingId}
              isFavorite={favoriteIds.includes(station.id)}
              onSelect={onSelect}
              onPrimary={onPrimary}
            />
          ))}
        </div>
      )}
    </section>
  );
}
