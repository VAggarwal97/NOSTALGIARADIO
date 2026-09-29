import type { ExternalLink } from '../types/station';
import { DONATE_LINK } from '../data/donate';
import { SearchIcon, QuestionIcon, SpotifyIcon, YoutubeIcon } from './Icons';

interface TopNavProps {
  compact: boolean;
  /** Spotify / YouTube Music links of the current station — shown only when configured. */
  serviceLinks: ExternalLink[];
  onOpenSearch: () => void;
  onOpenHelp: () => void;
}

const serviceIcon = (label: string) =>
  label.toLowerCase().includes('spotify') ? <SpotifyIcon size={15} /> : <YoutubeIcon size={15} />;

const isExternal = /^https?:\/\//i.test(DONATE_LINK.href);

/**
 * A utility bar, not navigation: brand, service links, donate, help, search.
 * No tagline — photography, type and copy carry the identity instead.
 * Categories deliberately live inside the hero gallery: pressing one re-tunes
 * the same screen instead of routing anywhere.
 */
export function TopNav({ compact, serviceLinks, onOpenSearch, onOpenHelp }: TopNavProps) {
  return (
    <header className="topnav" data-compact={compact}>
      <div className="topnav-inner wrap">
        <a className="brand" href="./" aria-label="Nostalgia Radio — home">
          <span className="brand-name">Nostalgia Radio</span>
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

          {/* Placeholder destination — swap `DONATE_LINK.href` when it exists. */}
          <a
            className="donate-btn"
            href={DONATE_LINK.href}
            {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            title="Support Nostalgia Radio"
          >
            {DONATE_LINK.label}
          </a>

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
