import type { MouseEvent } from 'react';

import { DONATE_LINK } from '../data/donate';
import { getSetting } from '../lib/live-catalogue';
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

const isExternalDonateUrl = (url: string): boolean => /^https?:\/\//i.test(url);

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

  // Donation destination: the runtime `donation_url` setting (set from
  // /admin → Settings) wins; otherwise the bundled href when it is real.
  // Until one exists the slot renders disabled — never a dead "#".
  const runtimeDonate = getSetting('donation_url');
  const donateHref = runtimeDonate && isExternalDonateUrl(runtimeDonate)
    ? runtimeDonate
    : isExternalDonateUrl(DONATE_LINK.href)
      ? DONATE_LINK.href
      : '';
  const hasDonate = donateHref !== '';

  // The masthead follows the live `site_name` setting — same story as the
  // document title — with the shipped brand as the honest default.
  const brandName = getSetting('site_name')?.trim() || 'Nostalgia Radio';

  return (
    <header className="topnav" data-compact={compact}>
      <div className="topnav-inner wrap">
        <a className="brand" href={homeHref()} aria-label={`${brandName} — home`}>
          <span className="brand-name">{brandName}</span>
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

          {/* Donation slot — enabled only when a real destination exists. */}
          {hasDonate ? (
            <a
              className="nav-link nav-link-donate"
              href={donateHref}
              {...(isExternalDonateUrl(donateHref) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {DONATE_LINK.label}
            </a>
          ) : (
            <span className="nav-link nav-link-donate" aria-disabled="true" title="Donation link not configured yet">
              {DONATE_LINK.label}
            </span>
          )}

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
