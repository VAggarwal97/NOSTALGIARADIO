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

/** Track metadata the app actually knows about — never invented. */
export interface NowPlaying {
  title: string;
  subtitle: string;
}

export interface Station {
  /** Unique even when display names repeat. Never derive from the name. */
  id: string;
  name: string;
  /**
   * Home category. Only the designated MIX flagship may use `'mix'`;
   * every other station uses a real category.
   */
  category: CategoryId;
  /** Optional extra rails this station also belongs to. */
  secondaryCategories?: Exclude<CategoryId, 'mix'>[];
  description: string;
  /** Cinematic artwork served from /public/art. */
  artwork: string;
  /**
   * Two-line hero title: `["Truck Wala", "Radio"]` renders line 1 in ivory and
   * line 2 in the accent colour. Derived from the name when omitted.
   */
  titleLines?: [string, string];
  /** Station accent used by the hero, CTA and active chip. Defaults to the category accent. */
  accent?: string;
  /** The station that represents its category when its chip is selected. */
  flagship?: boolean;
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
  /** Appears in the archive rail. */
  featured?: boolean;
  /** Ships with locally generated sample audio instead of a licensed stream. */
  demo?: boolean;
  /** Real track metadata for the player. Absent = show the station, not a song. */
  nowPlaying?: NowPlaying;
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
  /** Station shown in the hero when this chip is selected. */
  flagship: string;
  /** Default accent for the category's experience. */
  accent: string;
}

export interface EditorialMoment {
  id: string;
  quote: string;
  caption: string;
  artwork: string;
}
