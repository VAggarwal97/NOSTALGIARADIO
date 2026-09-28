export type CategoryId =
  | 'mix'
  | 'transit'
  | 'beyond-india'
  | 'regional-folk'
  | 'ambient'
  | 'festival'
  | 'work'
  | 'shops';

/** `play` = first-class audio in this app. `check` = source only, never fake playback. */
export type StationAction = 'play' | 'check';

export type SourceType = 'external-site' | 'direct-audio' | 'embed';

/**
 * ready   — source validated, playable or openable
 * offline — flagged as not responding: shown as Check, never as playing
 * unknown — not yet verified
 */
export type StationStatus = 'ready' | 'offline' | 'unknown';

export interface ExternalLink {
  label: string;
  url: string;
}

export interface Station {
  /** Unique even when display names repeat. Never derive from the name. */
  id: string;
  name: string;
  /** Home category. Membership in MIX is expressed with `featured`. */
  category: Exclude<CategoryId, 'mix'>;
  /** Optional extra rails this station also belongs to. */
  secondaryCategories?: Exclude<CategoryId, 'mix'>[];
  description: string;
  /** Cinematic artwork served from /public/art. */
  artwork: string;
  /** Primary source page (website of the station / stream owner). */
  url: string;
  /** Direct audio URL. Required when `action === 'play'`. */
  audioUrl?: string;
  action: StationAction;
  sourceType: SourceType;
  status?: StationStatus;
  /** Spotify / YouTube Music / source — rendered only when actually configured. */
  externalLinks?: ExternalLink[];
  tags?: string[];
  region?: string;
  language?: string[];
  era?: string;
  /** Appears in the FEATURED PICKS rail. */
  featured?: boolean;
  /** Ships with locally generated sample audio instead of a licensed stream. */
  demo?: boolean;
  /** Editorial ordering; array order is the default. */
  sortOrder?: number;
}

export interface Category {
  id: CategoryId;
  /** Full heading used on rails. */
  label: string;
  /** Compact uppercase nav label. */
  shortLabel: string;
  tagline: string;
  icon: string;
}

export interface EditorialMoment {
  id: string;
  quote: string;
  caption: string;
  artwork: string;
}
