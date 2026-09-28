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

export type Availability = 'available' | 'unavailable' | 'unknown';

export interface Station {
  /** Unique even when display names repeat. Never derive from the name. */
  id: string;
  name: string;
  /** Home category. Membership in MIX is expressed with `featured`. */
  category: Exclude<CategoryId, 'mix'>;
  description: string;
  /** Primary source page (website of the station / stream owner). */
  url: string;
  /** Direct audio URL. Required when `action === 'play'`. */
  audioUrl?: string;
  action: StationAction;
  sourceType: SourceType;
  availability?: Availability;
  rating?: number;
  ratingCount?: number;
  heat?: number;
  tags?: string[];
  language?: string[];
  region?: string;
  era?: string;
  /** Appears in the MIX discovery rail. */
  featured?: boolean;
  /** Ships with locally generated sample audio instead of a licensed stream. */
  demo?: boolean;
}

export interface Category {
  id: CategoryId;
  label: string;
  shortLabel: string;
  tagline: string;
  icon: string;
}
