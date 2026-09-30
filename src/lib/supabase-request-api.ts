import type {
  BoardQuery,
  RequestApi,
  SongRequest,
  SuggestFailure,
  SuggestResult,
  TrackMeta,
  VoteFailure,
} from './request-api';
import { MAX_ARTIST, MAX_TITLE, isSafeHttpUrl, parseSongUrl } from './request-api';
import { hasVoted, markVoted, visitorToken } from './community-identity';
import { createBrowserWallStore } from './supabase-wall-store';
import { WallQueryError } from './wall-store';
import type { WallRow, WallStore } from './wall-store';

/**
 * The community request API backed by Supabase — the same `RequestApi` the
 * local store implements, so every screen (board, console, deep links, queue)
 * works unchanged. The rules it keeps from V1:
 *
 *  - success is shown only after the database confirms the write;
 *  - counts are read back from the aggregate, never incremented locally;
 *  - "have I voted" is device memory (`community-identity`), the count is not;
 *  - a request that aired *this session* retires to history immediately, while
 *    the database-wide transition stays an admin action (README §8.4);
 *  - unknown database signals are re-thrown so the UI shows an honest failure
 *    instead of pretending something succeeded.
 */

/** Device-side identity the adapter writes with and reads `mine` from. */
export interface WallIdentity {
  token(): string;
  hasVoted(requestId: string): boolean;
  markVoted(requestId: string): void;
}

export interface SupabaseRequestOptions {
  identity?: WallIdentity;
  /** Count/list convergence poll. 0 disables it (tests). Default 20 s. */
  pollMs?: number;
  now?: () => number;
}

/** How many rows the board and the header total ever ask for. */
const BOARD_LIMIT = 60;
const LIST_LIMIT = 200;
const DEFAULT_POLL_MS = 20_000;

const browserIdentity: WallIdentity = { token: visitorToken, hasVoted, markVoted };

const toEpoch = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
};

const toIso = (at: number): string => new Date(at).toISOString();

/** Row → wall model. Hidden statuses never arrive; shapes are still verified. */
const toRequest = (row: WallRow): SongRequest | null => {
  const provider = row.provider === 'youtube' || row.provider === 'spotify' ? row.provider : null;
  if (!provider || typeof row.title !== 'string') return null;
  return {
    id: row.id,
    song: { provider, id: row.provider_id, url: row.song_url },
    title: row.title,
    artist: (row.artist ?? '').trim() || 'Unknown artist',
    artwork: row.artwork_url && isSafeHttpUrl(row.artwork_url) ? row.artwork_url : null,
    status: row.status === 'played' ? 'played' : 'open',
    votes: typeof row.votes === 'number' && row.votes > 0 ? row.votes : 0,
    createdAt: toEpoch(row.created_at),
    lastVotedAt: toEpoch(row.last_voted_at),
    playedAt: row.played_at ? toEpoch(row.played_at) : null,
    stationId: row.station_id ?? null,
    mine: false, // filled per caller (device memory), see `present`
  };
};

/** A request as this device remembers it: DB row + local session overrides. */
interface AdapterContext {
  store: WallStore;
  identity: WallIdentity;
  now: () => number;
  /** Requests retired by this session's playback, kept as their final row. */
  sessionRows: Map<string, { row: WallRow; playedAt: number }>;
  notify: () => void;
}

const present = (ctx: AdapterContext, row: WallRow): SongRequest | null => {
  const effective = ctx.sessionRows.get(row.id)?.row ?? row;
  const request = toRequest(effective);
  if (!request) return null;
  return { ...request, mine: ctx.identity.hasVoted(request.id) };
};

/** DB signal → the wall's failure vocabulary (README §6). */
const suggestReason = (error: unknown): Extract<SuggestFailure, 'duplicate' | 'rate-limited'> | null => {
  if (!(error instanceof WallQueryError)) return null;
  if (error.message.startsWith('rate-limited:')) return 'rate-limited';
  if (error.code === '23505') return 'duplicate'; // suggestions_one_per_song
  if (error.code === 'P0001') return 'rate-limited'; // our rate-limit raise
  return null;
};

const voteReason = (error: unknown): VoteFailure | null => {
  if (!(error instanceof WallQueryError)) return null;
  if (error.message.startsWith('rate-limited:') || error.code === 'P0001') return 'rate-limited';
  if (error.code === '23505') return 'already-voted'; // votes_one_per_suggestion
  if (error.code === '42501') return 'unavailable'; // RLS: target not open for votes
  if (error.code === '23503') return 'not-found';
  return null;
};

/** The same tab rules as the local store, applied after SQL (session safety). */
const holdsTab = (request: SongRequest, tab: BoardQuery['tab']): boolean => {
  if (tab === 'played') return request.status === 'played';
  if (request.status !== 'open') return false;
  if (tab === 'rising') return request.lastVotedAt > 0;
  return true;
};

const matchesQuery = (request: SongRequest, raw: string | undefined): boolean => {
  const needle = (raw ?? '').trim().toLowerCase();
  if (!needle) return true;
  return request.title.toLowerCase().includes(needle) || request.artist.toLowerCase().includes(needle);
};

/** Offline-tolerant snapshot of a request retiring to history (README §8.4). */
const rowFromRequest = (request: SongRequest): WallRow => {
  const at = request.createdAt || Date.now();
  const iso = toIso(at);
  return {
    id: request.id,
    song_url: request.song.url,
    provider: request.song.provider,
    provider_id: request.song.id,
    title: request.title,
    artist: request.artist,
    artwork_url: request.artwork,
    station_id: request.stationId,
    status: request.status === 'played' ? 'played' : 'approved',
    played_at: request.playedAt ? toIso(request.playedAt) : null,
    created_at: iso,
    updated_at: iso,
    votes: request.votes,
    last_voted_at: request.lastVotedAt ? toIso(request.lastVotedAt) : null,
  };
};

export function createSupabaseRequestApi(
  store: WallStore,
  options: SupabaseRequestOptions = {},
): RequestApi {
  const identity = options.identity ?? browserIdentity;
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const ctx: AdapterContext = { store, identity, now, sessionRows: new Map(), notify };

  // Live channel + convergence poll: realtime covers new rows and moderation
  // changes; the poll is what moves VOTE counts (votes are never published).
  let stopChanges: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const ensureLive = (): void => {
    if (stopChanges === null && store.subscribeChanges) {
      try {
        stopChanges = store.subscribeChanges(() => notify());
      } catch {
        stopChanges = null; // realtime unavailable → the poll alone converges
      }
    }
    if (pollTimer === null && pollMs > 0 && typeof window !== 'undefined') {
      pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        notify();
      }, pollMs);
      (pollTimer as unknown as { unref?: () => void }).unref?.();
    }
  };
  const stopLive = (): void => {
    stopChanges?.();
    stopChanges = null;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return {
    async submit({ url, meta, stationId }: { url: string; meta: TrackMeta; stationId: string | null }): Promise<SuggestResult> {
      const song = parseSongUrl(url);
      if (!song) return { ok: false, reason: 'invalid-url' };
      const title = (meta?.title ?? '').trim();
      if (!title) return { ok: false, reason: 'invalid-meta' };

      try {
        const row = await store.insertSuggestion({
          song_url: song.url,
          provider: song.provider,
          provider_id: song.id,
          title: title.slice(0, MAX_TITLE),
          artist: (meta.artist ?? '').trim().slice(0, MAX_ARTIST) || 'Unknown artist',
          artwork_url: meta.artwork && isSafeHttpUrl(meta.artwork) ? meta.artwork : null,
          station_id: stationId,
          visitor_token: identity.token(),
        });
        const request = present(ctx, row);
        if (!request) throw new WallQueryError(null, 'submitted row could not be read');
        notify();
        return { ok: true, request };
      } catch (error) {
        const reason = suggestReason(error);
        if (reason) return { ok: false, reason };
        throw error; // outage / unexpected signal → the console shows a real failure
      }
    },

    async list() {
      const rows = await store.list(LIST_LIMIT);
      const items: SongRequest[] = [];
      for (const row of rows) {
        const request = present(ctx, row);
        if (request) items.push(request);
      }
      // Session-retired rows must keep their place even though the database
      // still counts them as approved.
      for (const entry of ctx.sessionRows.values()) {
        if (items.some((item) => item.id === entry.row.id)) continue;
        const request = present(ctx, entry.row);
        if (request) items.push(request);
      }
      items.sort((a, b) => b.createdAt - a.createdAt);
      return items;
    },

    async board({ tab, query }: BoardQuery) {
      const rows = await store.board(tab, (query ?? '').trim(), BOARD_LIMIT);
      const items: SongRequest[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const request = present(ctx, row);
        if (!request) continue;
        seen.add(request.id);
        items.push(request);
      }
      if (tab === 'played') {
        for (const entry of ctx.sessionRows.values()) {
          if (seen.has(entry.row.id)) continue;
          const request = present(ctx, entry.row);
          if (request) items.push(request);
        }
      }
      const visible = items.filter(
        (item) => holdsTab(item, tab) && matchesQuery(item, query),
      );
      if (tab === 'played') visible.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
      return visible;
    },

    async find(url) {
      const song = parseSongUrl(url);
      if (!song) return null;
      const row = await store.bySong(song.provider, song.id);
      return row ? present(ctx, row) : null;
    },

    async get(id) {
      const row = await store.byId(id);
      return row ? present(ctx, row) : null;
    },

    async vote(id) {
      if (ctx.sessionRows.has(id)) return { ok: false, reason: 'unavailable' };
      try {
        await store.insertVote(id, identity.token());
      } catch (error) {
        const reason = voteReason(error);
        // The database knows this device voted — remember that locally too.
        if (reason === 'already-voted') identity.markVoted(id);
        if (reason) return { ok: false, reason };
        throw error;
      }
      identity.markVoted(id);
      notify();
      const row = await store.byId(id);
      const request = row ? present(ctx, row) : null;
      if (!request) throw new WallQueryError(null, 'voted request could not be reloaded');
      return { ok: true, request };
    },

    async markPlayed(id, played) {
      let row = ctx.sessionRows.get(id)?.row ?? null;
      if (!row) {
        try {
          row = played ? rowFromRequest(played) : await store.byId(id);
        } catch {
          row = played ? rowFromRequest(played) : null; // offline: still retire locally
        }
      }
      if (!row) return null;
      if (row.status === 'played') return present(ctx, row); // already history

      const playedAt = now();
      const iso = toIso(playedAt);
      const retired: WallRow = { ...row, status: 'played', played_at: iso, updated_at: iso };
      ctx.sessionRows.set(id, { row: retired, playedAt });
      notify();
      return present(ctx, retired);
    },

    subscribe(listener) {
      listeners.add(listener);
      ensureLive();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopLive();
      };
    },
  };
}

/**
 * Production wiring for the public site: the browser store (publishable
 * values only) plus this device's anonymous identity. Only ever reached from
 * `createSharedRequestApi()` — guarded to configured browsers, never SSR.
 */
export function createCommunityRequestApi(): RequestApi {
  return createSupabaseRequestApi(createBrowserWallStore());
}
