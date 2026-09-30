/**
 * URL shapes for the two views of Nostalgia Radio. One site, two compositions:
 * the cinematic home screen and the community request wall. Links are real
 * hrefs (shareable, middle-clickable) while in-app clicks are intercepted for
 * a history-API navigation that never reloads or restarts playback.
 */

export const SUGGEST_PATH = '/suggest-music';
export const ADMIN_PATH = '/admin';

export type RouteName = 'home' | 'suggest' | 'admin';

export const homeHref = (): string => '/';
export const suggestHref = (): string => SUGGEST_PATH;
export const adminHref = (): string => ADMIN_PATH;

export const routeFromPathname = (pathname: string): RouteName => {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === SUGGEST_PATH) return 'suggest';
  if (trimmed === ADMIN_PATH) return 'admin';
  return 'home';
};

/** Shared-request deep link: /suggest-music?request=<id>. */
export const requestIdFromSearch = (search: string): string | null => {
  const value = new URLSearchParams(search).get('request');
  return value && /^[\w-]{4,64}$/.test(value) ? value : null;
};

export const shareHref = (requestId: string): string =>
  `${SUGGEST_PATH}?request=${encodeURIComponent(requestId)}`;

type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** Plain left click only — modified clicks keep their native tab behaviour. */
export const isPlainLeftClick = (event: ClickLike): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
