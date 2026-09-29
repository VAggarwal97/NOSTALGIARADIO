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
 * Official playback providers. Stations configured with one are driven through
 * the provider's own embed API (YouTube IFrame API / Spotify iFrame API) —
 * never through scraped, proxied or re-hosted audio.
 */
export type ProviderId = 'youtube' | 'spotify';

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
   * Alternative hero backdrops (https image URLs): one is drawn at random per
   * page load, so reloading changes the stage. `artwork` remains the identity
   * everywhere else — player, cards and shares never flicker.
   */
  backdrops?: string[];
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
  /**
   * Playback provider when the station is backed by an official playlist.
   * Together with `playlistUrl` this is the only thing to edit to re-tune a
   * provider station — no component changes.
   */
  provider?: ProviderId;
  /**
   * The playlist page on that provider, e.g.
   * `https://www.youtube.com/playlist?list=…` or
   * `https://open.spotify.com/playlist/…`. Must match `provider`.
   */
  playlistUrl?: string;
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
