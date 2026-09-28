import type { Station } from '../types/station';
import { StationCard } from './StationCard';

interface StationRailProps {
  id: string;
  title: string;
  note?: string;
  stations: Station[];
  selectedId: string | null;
  playingId: string | null;
  emptyMessage?: string;
  onSelect: (station: Station) => void;
  onPrimary: (station: Station) => void;
}

export function StationRail({
  id,
  title,
  note,
  stations,
  selectedId,
  playingId,
  emptyMessage,
  onSelect,
  onPrimary,
}: StationRailProps) {
  return (
    <section className="rail-section" aria-labelledby={`${id}-title`} id={id}>
      <div className="rail-head">
        <h2 className="rail-title" id={`${id}-title`}>
          {title}
        </h2>
        {note ? <span className="rail-note">{note}</span> : null}
      </div>

      {stations.length === 0 ? (
        <div className="wrap">
          <p className="empty">{emptyMessage ?? 'Nothing here yet — try another category.'}</p>
        </div>
      ) : (
        <div className="rail" role="group" aria-label={title}>
          {stations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              selected={station.id === selectedId}
              playing={station.id === playingId}
              onSelect={onSelect}
              onPrimary={onPrimary}
            />
          ))}
        </div>
      )}
    </section>
  );
}
