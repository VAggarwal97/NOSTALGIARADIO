import { useEffect, useState } from 'react';
import type { CategoryId, ExternalLink } from '../types/station';
import { CATEGORIES } from '../data/categories';
import { findStation } from '../lib/catalog';
import { CategoryNav } from './CategoryNav';
import { CloseIcon, MenuIcon, SearchIcon, QuestionIcon, SpotifyIcon, YoutubeIcon } from './Icons';

interface TopNavProps {
  activeCategory: CategoryId;
  compact: boolean;
  /** Spotify / YouTube Music links of the current station — shown only when configured. */
  serviceLinks: ExternalLink[];
  onSelectCategory: (id: CategoryId) => void;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
}

const serviceIcon = (label: string) =>
  label.toLowerCase().includes('spotify') ? <SpotifyIcon size={15} /> : <YoutubeIcon size={15} />;

export function TopNav({
  activeCategory,
  compact,
  serviceLinks,
  onSelectCategory,
  onOpenSearch,
  onOpenHelp,
}: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const selectAndClose = (id: CategoryId) => {
    onSelectCategory(id);
    setMenuOpen(false);
  };

  return (
    <>
      <header className="topnav" data-compact={compact}>
        <div className="topnav-inner wrap">
          <a className="brand" href="./" aria-label="Nostalgia Radio — home">
            <span className="brand-name">Nostalgia Radio</span>
            <span className="brand-micro">No login · No database · Just stations</span>
          </a>

          <CategoryNav active={activeCategory} onSelect={onSelectCategory} />

          <div className="nav-tools">
            {serviceLinks.map((link) => (
              <a
                key={link.label}
                className="service-btn"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${link.label}`}
              >
                {serviceIcon(link.label)}
                <span>{link.label}</span>
                <span className="visually-hidden"> — opens in a new tab</span>
              </a>
            ))}

            <button type="button" className="icon-btn" onClick={onOpenHelp} title="Keyboard controls (?)">
              <QuestionIcon />
              <span className="visually-hidden">Keyboard controls</span>
            </button>

            <button type="button" className="icon-btn" onClick={onOpenSearch} title="Search (press /)">
              <SearchIcon />
              <span className="visually-hidden">Search stations</span>
            </button>

            <button
              type="button"
              className="icon-btn menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Choose a station"
              aria-expanded={menuOpen}
            >
              <MenuIcon size={20} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="station-menu" role="dialog" aria-modal="true" aria-label="Station selectors">
          <div className="station-menu-head">
            <span className="brand-name" style={{ fontSize: '1.15rem' }}>
              Stations
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen(false)}
              aria-label="Close station list"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="station-menu-list">
            {CATEGORIES.map((category) => {
              const flagship = findStation(category.flagship);
              return (
                <button
                  key={category.id}
                  type="button"
                  className="station-menu-item"
                  aria-pressed={activeCategory === category.id}
                  onClick={() => selectAndClose(category.id)}
                >
                  <span className="station-menu-name">{flagship?.name ?? category.label}</span>
                  <span className="station-menu-sub">{category.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
