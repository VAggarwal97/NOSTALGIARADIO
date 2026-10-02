import type { SongProvider } from './request-api';

/**
 * The thin seam between the community request API and PostgREST: every
 * database operation the wall performs is spelled out here as a promise of
 * plain rows, so the RequestApi adapter can be tested against an in-memory
 * store with no network, and the Supabase implementation stays a pure
 * translation layer (queries in, rows out).
 *
 * Rows are always *public* rows: the column grant never includes
 * `visitor_token`, counts arrive as aggregates (`votes` from
 * `suggestion_vote_counts` / `wall_board`, `likes` from `song_like_counts` —
 * never as stored columns on `suggestions`), and hidden statuses
 * (pending / rejected) simply do not exist for this role.
 */

/** A suggestion exactly as the public column grant returns it, plus counts. */
export interface WallRow {
  id: string;
  song_url: string;
  provider: string;
  provider_id: string;
  title: string;
  artist: string | null;
  artwork_url: string | null;
  station_id: string | null;
  status: string;
  played_at: string | null;
  created_at: string;
  updated_at: string;
  /** Aggregate from `suggestion_vote_counts` / `wall_board` — never stored on the row. */
  votes: number;
  /** Aggregate from `song_like_counts` — never stored on the row. */
  likes: number;
  last_voted_at: string | null;
}

/**
 * What a visitor may submit. Deliberately has **no `status` field**: the
 * database default decides visibility (seamless `approved` in migration 5,
 * `pending` when strict pre-moderation is restored) — the browser never
 * dictates a moderation state.
 */
export interface NewSuggestion {
  song_url: string;
  provider: SongProvider;
  provider_id: string;
  title: string;
  artist: string;
  artwork_url: string | null;
  station_id: string | null;
  visitor_token: string;
}

/** Query failure with the database's own signal attached (see README §6). */
export class WallQueryError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = 'WallQueryError';
    this.code = code;
  }
}

export interface WallStore {
  /** Server-side board: ordering, search and the clamped limit live in SQL. */
  board(tab: string, query: string, limit: number): Promise<WallRow[]>;
  /** Newest first, capped — the header total, never a whole archive. */
  list(limit: number): Promise<WallRow[]>;
  byId(id: string): Promise<WallRow | null>;
  bySong(provider: SongProvider, providerId: string): Promise<WallRow | null>;
  insertSuggestion(row: NewSuggestion): Promise<WallRow>;
  insertVote(suggestionId: string, visitorToken: string): Promise<void>;
  /** One like per (request, visitor); 23505 when already liked. */
  insertLike(suggestionId: string, visitorToken: string): Promise<void>;
  /** Optional live channel (realtime); the poll in the adapter covers counts. */
  subscribeChanges?(onChange: () => void): () => void;
}
