import type { MouseEvent } from 'react';

import { DONATE_LINK } from '../data/donate';
import { homeHref, suggestHref, type RouteName } from '../lib/routes';

type HomeNavProps = {
  compact: boolean;
  /** Which view we're on — the masthead links to the other one. */
  route: RouteName;
  onNavigate: (path: string) => void;
  onHelp: () => void;
  onSearch: () => void;
};

const EXTERNAL_LINKS = [
  { label: 'Spotify', href: 'https://open.spotify.com/', host: 'open.spotify.com' },
  { label: 'YouTube Music', href: 'https://music.youtube.com/', host: 'music.youtube.com' },
] as const;

const isExternalDonate = /^https?:\/\//i.test(DONATE_LINK.href);

/**
 * A film masthead, not an app toolbar: brand on the left, quiet text
 * navigation on the right. No pills, boxes, borders or circular icons —
 * type, spacing and a hairline hover underline carry the hierarchy.
 * "Suggest music" is a real, shareable link to the community page (and
 * reads "Radio" while you are on it); modified clicks keep their native
 * new-tab behaviour.
 */
export function HomeNav({ compact, route, onNavigate, onHelp, onSearch }: HomeNavProps) {
  const intercept = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <header className="topnav" data-compact={compact}>
      <div className="topnav-inner wrap">
        <a className="brand" href={homeHref()} aria-label="Nostalgia Radio — home">
          <span className="brand-name">Nostalgia Radio</span>
        </a>

        <nav className="nav-links" aria-label="Radio utilities">
          <a
            className="nav-link nav-link-suggest"
            href={route === 'suggest' ? homeHref() : suggestHref()}
            onClick={intercept(route === 'suggest' ? homeHref() : suggestHref())}
          >
            {route === 'suggest' ? 'Radio' : 'Suggest music'}
          </a>

          {EXTERNAL_LINKS.map((link) => (
            <a
              key={link.label}
              className="nav-link nav-link-external"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {link.label}
              <span className="nav-out" aria-hidden="true">
                ↗
              </span>
              <span className="visually-hidden"> — opens {link.host} in a new tab</span>
            </a>
          ))}

          {/* Placeholder destination — swap DONATE_LINK.href in src/data/donate.ts. */}
          <a
            className="nav-link nav-link-donate"
            href={DONATE_LINK.href}
            {...(isExternalDonate ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            Donate
          </a>

          <button type="button" className="nav-link nav-link-quiet" onClick={onHelp}>
            ?
            <span className="visually-hidden">Keyboard controls</span>
          </button>

          <button type="button" className="nav-link nav-link-quiet" onClick={onSearch}>
            ⌕
            <span className="visually-hidden">Search</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

export type { HomeNavProps };
