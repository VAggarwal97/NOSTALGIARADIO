import type { ExternalLink } from '../types/station';
import { SearchIcon, QuestionIcon, SpotifyIcon, YoutubeIcon, HeartIcon } from './Icons';

interface TopNavProps {
  compact: boolean;
  /** Spotify / YouTube Music links of the current station — shown only when configured. */
  serviceLinks: ExternalLink[];
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  onOpenSupport: () => void;
}

const serviceIcon = (label: string) =>
  label.toLowerCase().includes('spotify') ? <SpotifyIcon size={15} /> : <YoutubeIcon size={15} />;

/**
 * A utility bar, not navigation: brand, service links, support, help, search.
 * Categories deliberately live inside the hero gallery — pressing one re-tunes
 * the same screen instead of routing anywhere.
 */
export function TopNav({
  compact,
  serviceLinks,
  onOpenSearch,
  onOpenHelp,
  onOpenSupport,
}: TopNavProps) {
  return (
    <header className="topnav" data-compact={compact}>
      <div className="topnav-inner wrap">
        <a className="brand" href="./" aria-label="Nostalgia Radio — home">
          <span className="brand-name">Nostalgia Radio</span>
          <span className="brand-micro">No login · No database · Just stations</span>
        </a>

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

          <button type="button" className="donate-btn" onClick={onOpenSupport}>
            <HeartIcon size={15} />
            <span className="donate-label">Donate</span>
          </button>

          <button type="button" className="icon-btn" onClick={onOpenHelp} title="Keyboard controls (?)">
            <QuestionIcon />
            <span className="visually-hidden">Keyboard controls</span>
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
