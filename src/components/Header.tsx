import type { ReactNode } from 'react';
import { SearchIcon, ShuffleIcon, HeartIcon, SunIcon, RadioIcon } from './Icons';

interface HeaderProps {
  /** Category rail — persistent top-bar zone, own row on mobile. */
  rail: ReactNode;
  favoriteCount: number;
  theme: 'dark' | 'warm';
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  onSurprise: () => void;
  onToggleTheme: () => void;
}

export function Header({
  rail,
  favoriteCount,
  theme,
  onOpenSearch,
  onOpenFavorites,
  onSurprise,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <RadioIcon size={18} />
        </span>
        <span className="brand-text">
          <span className="brand-name">Nostalgia Radio</span>
          <span className="brand-sub">No login · No database · Just stations</span>
        </span>
      </div>

      {rail}

      <nav className="header-actions" aria-label="Utilities">
        <button type="button" className="icon-btn" onClick={onSurprise} title="Surprise me (R)">
          <ShuffleIcon />
          <span className="visually-hidden">Surprise me</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenFavorites}
          title="My stations, saved on this device"
          aria-label={`My stations, ${favoriteCount} saved`}
        >
          <HeartIcon filled={favoriteCount > 0} />
          {favoriteCount > 0 && <span className="kbd">{favoriteCount}</span>}
        </button>

        <button type="button" className="icon-btn" onClick={onOpenSearch} title="Search (press /)">
          <SearchIcon />
          <span className="visually-hidden">Search stations</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-pressed={theme === 'warm'}
          title="Warm / dark variant"
        >
          <SunIcon />
          <span className="visually-hidden">Toggle warm theme</span>
        </button>
      </nav>
    </header>
  );
}
