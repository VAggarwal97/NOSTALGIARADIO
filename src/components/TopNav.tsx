import type { ReactNode } from 'react';
import { SearchIcon, ShuffleIcon, HeartIcon } from './Icons';

interface TopNavProps {
  /** Category nav — filters the page content in place, never a new page. */
  nav: ReactNode;
  compact: boolean;
  favoriteCount: number;
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  onSurprise: () => void;
}

export function TopNav({
  nav,
  compact,
  favoriteCount,
  onOpenSearch,
  onOpenFavorites,
  onSurprise,
}: TopNavProps) {
  return (
    <header className="topnav" data-compact={compact}>
      <div className="topnav-inner wrap">
        <a className="brand" href="./" aria-label="Nostalgia Radio — home">
          <span className="brand-name">Nostalgia Radio</span>
          <span className="brand-micro">No login · No database · Just stations</span>
        </a>

        {nav}

        <div className="nav-tools">
          <button type="button" className="icon-btn" onClick={onSurprise} title="Surprise me (R)">
            <ShuffleIcon />
            <span className="visually-hidden">Surprise me</span>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={onOpenFavorites}
            aria-pressed={favoriteCount > 0}
            title="My stations, saved on this device"
            aria-label={`My stations, ${favoriteCount} saved on this device`}
          >
            <HeartIcon filled={favoriteCount > 0} />
          </button>

          <button type="button" className="icon-btn" onClick={onOpenSearch} title="Search (press /)">
            <SearchIcon />
            <span className="visually-hidden">Search stations</span>
          </button>
        </div>
      </div>
    </header>
  );
}
