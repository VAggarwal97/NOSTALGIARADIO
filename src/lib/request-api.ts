import { randomId } from './id';

/**
 * The community request wall ("Suggest your music") — API-shaped like the
 * rest of the site: strict URL validation, duplicate detection, rate limits,
 * one vote per visitor and honest aggregates all live inside this module, so
 * a real backend (e.g. Supabase with `UNIQUE(request_id, visitor_id)`) can
 * replace the local implementation without touching the UI. No keys in this
 * repo; the client never owns a vote count, a status or a ranking.
 *
 * V1 runs on an in-memory store synchronised between this browser's tabs via
 * BroadcastChannel — real sessions only, no seeded numbers anywhere. A board
 * with no requests honestly says "no requests yet".
 *
 * Only links that are unmistakably songs are accepted: a YouTube video or a
 * Spotify track. Albums, playlists, channels and everything else are refused.
 */

export type SongProvider = 'youtube' | 'spotify';

export interface SongRef {
  provider: SongProvider;
  /** Provider-native ID — the identity used for duplicate detection. */
  id: string;
  /** Normalised share URL — what a future queue would store. */
  url: string;
}

/** Metadata resolved from the provider (see lib/track-meta) at submit time. */
export interface TrackMeta {
  title: string;
  artist: string;
  artwork: string | null;
}

/**
 * Public lifecycle. Moderation-only states (pending / rejected / hidden) stay
 * backend concerns; the wall renders exactly these three.
 */
export type RequestStatus = 'open' | 'played' | 'unavailable';

export interface SongRequest {
  id: string;
  song: SongRef;
  title: string;
  artist: string;
  artwork: string | null;
  status: RequestStatus;
  /** Honest aggregate: 0 until somebody actually votes. */
  votes: number;
  createdAt: number;
  /** Last time any visitor voted — the raw material of "rising". 0 = never. */
  lastVotedAt: number;
  playedAt: number | null;
  stationId: string | null;
  /** True when this session's visitor id is among the voters. */
  mine: boolean;
}

export type RequestTab = 'wanted' | 'rising' | 'recent' | 'played';

export interface BoardQuery {
  tab: RequestTab;
  query?: string;
}

export type SuggestFailure = 'invalid-url' | 'invalid-meta' | 'duplicate' | 'rate-limited';

export type SuggestResult =
  | { ok: true; request: SongRequest }
  | { ok: false; reason: SuggestFailure };

export type VoteFailure = 'not-found' | 'already-voted' | 'unavailable' | 'rate-limited';

export type VoteResult = { ok: true; request: SongRequest } | { ok: false; reason: VoteFailure };

export interface RequestApi {
  submit(input: { url: string; meta: TrackMeta; stationId: string | null }): Promise<SuggestResult>;
  /** Newest first — everything on the board, any status. */
  list(): Promise<SongRequest[]>;
  /** Tab order + search, as the community page reads it. */
  board(query: BoardQuery): Promise<SongRequest[]>;
  /** Duplicate lookup by provider identity before showing a preview. */
  find(url: string): Promise<SongRequest | null>;
  /** Deep-linked request: /suggest-music?request=<id>. */
  get(id: string): Promise<SongRequest | null>;
  /** One vote per visitor per request — the server's job in a real backend. */
  vote(id: string): Promise<VoteResult>;
  /**
   * Backend hook: the radio marks a request played, moving it into history.
   * V1's local store exposes it (the wall's Played tab reads from it); a real
   * queue would call the same method after airplay.
   */
  markPlayed(id: string): Promise<SongRequest | null>;
  /** Fires on any local change or a neighbouring tab's snapshot. */
  subscribe(listener: () => void): () => void;
}

/** YouTube video IDs are exactly 11 URL-safe characters. */
const YOUTUBE_ID = /^[\w-]{11}$/;
/** Spotify track IDs are 22 base62 characters (10 keeps some headroom). */
const SPOTIFY_ID = /^[A-Za-z0-9]{10,}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]);

const youtube = (id: string): SongRef => ({
  provider: 'youtube',
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
});

const spotify = (id: string): SongRef => ({
  provider: 'spotify',
  id,
  url: `https://open.spotify.com/track/${id}`,
});

/**
 * Parse a pasted link down to a single song, or null if it isn't one.
 * Accepts: youtube watch/shorts/youtu.be videos, open.spotify.com tracks
 * (including /embed/ and /intl-xx/ forms). Rejects everything else.
 */
export function parseSongUrl(raw: string): SongRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return YOUTUBE_ID.test(id) ? youtube(id) : null;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return YOUTUBE_ID.test(id) ? youtube(id) : null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'shorts' && segments[1] && YOUTUBE_ID.test(segments[1])) {
      return youtube(segments[1]);
    }
    // Playlists, channels, handles, live … — songs only, not surfaces.
    return null;
  }

  if (host === 'open.spotify.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const trackAt = segments.indexOf('track');
    const id = trackAt >= 0 ? (segments[trackAt + 1] ?? '') : '';
    // /track/<id>, /embed/track/<id> and /intl-xx/track/<id> all qualify;
    // /album, /playlist, /artist … never contain a "track" segment.
    return SPOTIFY_ID.test(id) ? spotify(id) : null;
  }

  return null;
}

const RATE_WINDOW_MS = 60_000;
const MAX_SUBMITS_PER_WINDOW = 3;
const MAX_VOTES_PER_WINDOW = 10;
/** Oversized paste protection — nothing long ever reaches the board. */
const MAX_TITLE = 160;
const MAX_ARTIST = 120;

const isSafeHttpUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Local-store internals: one request row plus this tab's private voter bookkeeping.
 * Not an API surface — a real backend keeps voter ids in its own votes table.
 */
export interface StoredRequest extends Omit<SongRequest, 'mine'> {
  /** Local-only: which visitor ids voted from THIS tab. Never leaves it. */
  voters: Set<string>;
}

/**
 * The shared "database" of the local implementation. One store can serve several
 * API instances (each with its own visitor id), which is how tests reproduce
 * server-side uniqueness: two visitors, one source of truth.
 */
export interface RequestStore {
  rows: Map<string, StoredRequest>;
  bySong: Map<string, StoredRequest>;
}

export function createRequestStore(): RequestStore {
  return { rows: new Map(), bySong: new Map() };
}

/** What a neighbouring tab may see — counts and copy, never a voter id. */
type Snapshot = Omit<SongRequest, 'mine'>;

type ChannelMessage = { type: 'hello' } | { type: 'snapshot'; items: Snapshot[] };

const songKey = (song: SongRef): string => `${song.provider}:${song.id}`;

const isSnapshotItem = (value: unknown): value is Snapshot => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Snapshot>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.votes === 'number' &&
    !!item.song &&
    typeof item.song === 'object'
  );
};

/* Ranking rules, documented once (ties resolve deterministically, never at random): */
/** MOST WANTED — total votes, ties to the earlier submission. */
const byVotesThenAge = (a: StoredRequest, b: StoredRequest) => b.votes - a.votes || a.createdAt - b.createdAt;
/** RISING — recent voting activity, then volume, then age. */
const byRecentVotes = (a: StoredRequest, b: StoredRequest) =>
  b.lastVotedAt - a.lastVotedAt || b.votes - a.votes || a.createdAt - b.createdAt;
/** RECENTLY ADDED — newest first. */
const byNewest = (a: StoredRequest, b: StoredRequest) => b.createdAt - a.createdAt;
/** PLAYED — most recently played first. */
const byPlayedAt = (a: StoredRequest, b: StoredRequest) => (b.playedAt ?? 0) - (a.playedAt ?? 0);

const matchesQuery = (item: StoredRequest, raw: string | undefined): boolean => {
  const needle = (raw ?? '').trim().toLowerCase();
  if (!needle) return true;
  return item.title.toLowerCase().includes(needle) || item.artist.toLowerCase().includes(needle);
};

export function createLocalRequestApi(
  now: () => number = () => Date.now(),
  visitorId: string = randomId(),
  store: RequestStore = createRequestStore(),
): RequestApi {
  /** Rows by request id; a second index catches duplicates by song identity. */
  const { rows, bySong } = store;
  const submittedAt: number[] = [];
  const votedAt: number[] = [];
  const listeners = new Set<() => void>();

  // Same browser, different tabs: adopt neighbouring snapshots so votes and
  // new requests appear without a refresh. Node/tests stay channel-free —
  // and if a Node-like runtime does define window, unref so the process
  // (e.g. the smoke render) can still exit.
  const channel: BroadcastChannel | null =
    typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('nostalgia-requests')
      : null;
  (channel as unknown as { unref?: () => void } | null)?.unref?.();

  const snapshots = (): Snapshot[] =>
    [...rows.values()].map(({ voters: _voters, ...rest }) => rest);

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const share = () => {
    channel?.postMessage({ type: 'snapshot', items: snapshots() } satisfies ChannelMessage);
    notify();
  };

  const adopt = (items: Snapshot[]) => {
    let changed = false;
    for (const item of items) {
      if (!isSnapshotItem(item)) continue;
      const local = rows.get(item.id);
      // Keep this tab's own voter bookkeeping; take the shared counts/copy.
      const stored: StoredRequest = { ...item, voters: local?.voters ?? new Set() };
      rows.set(item.id, stored);
      bySong.set(songKey(item.song), stored);
      changed = true;
    }
    if (changed) notify();
  };

  channel?.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'snapshot' && Array.isArray(message.items)) adopt(message.items);
    // A fresh tab asks once; whoever has the board answers.
    if (message.type === 'hello' && rows.size > 0) share();
  });

  const present = (stored: StoredRequest): SongRequest => {
    const { voters, ...rest } = stored;
    return { ...rest, mine: voters.has(visitorId) };
  };

  const windowOk = (times: number[], max: number, at: number): boolean => {
    while (times.length > 0 && at - times[0] > RATE_WINDOW_MS) times.shift();
    return times.length < max;
  };

  return {
    async submit({ url, meta, stationId }) {
      const song = parseSongUrl(url);
      if (!song) return { ok: false, reason: 'invalid-url' };

      const title = (meta?.title ?? '').trim();
      // No trustworthy title → no request: the board never shows a hollow card.
      if (!title) return { ok: false, reason: 'invalid-meta' };

      if (bySong.has(songKey(song))) return { ok: false, reason: 'duplicate' };

      const at = now();
      if (!windowOk(submittedAt, MAX_SUBMITS_PER_WINDOW, at)) {
        return { ok: false, reason: 'rate-limited' };
      }

      const stored: StoredRequest = {
        id: randomId(),
        song,
        title: title.slice(0, MAX_TITLE),
        artist: (meta.artist ?? '').trim().slice(0, MAX_ARTIST) || 'Unknown artist',
        artwork: meta.artwork && isSafeHttpUrl(meta.artwork) ? meta.artwork : null,
        status: 'open',
        votes: 0,
        createdAt: at,
        lastVotedAt: 0,
        playedAt: null,
        stationId,
        voters: new Set(),
      };
      rows.set(stored.id, stored);
      bySong.set(songKey(song), stored);
      submittedAt.push(at);
      share();
      return { ok: true, request: present(stored) };
    },

    async list() {
      return [...rows.values()].sort(byNewest).map(present);
    },

    async board({ tab, query }) {
      const all = [...rows.values()];
      let list: StoredRequest[];
      switch (tab) {
        case 'wanted':
          list = all.filter((r) => r.status === 'open').sort(byVotesThenAge);
          break;
        case 'rising':
          list = all.filter((r) => r.status === 'open' && r.lastVotedAt > 0).sort(byRecentVotes);
          break;
        case 'recent':
          list = all.filter((r) => r.status === 'open').sort(byNewest);
          break;
        case 'played':
        default:
          list = all.filter((r) => r.status === 'played').sort(byPlayedAt);
          break;
      }
      return list.filter((row) => matchesQuery(row, query)).map(present);
    },

    async find(url) {
      const song = parseSongUrl(url);
      if (!song) return null;
      const stored = bySong.get(songKey(song));
      return stored ? present(stored) : null;
    },

    async get(id) {
      const stored = rows.get(id);
      return stored ? present(stored) : null;
    },

    async vote(id) {
      const stored = rows.get(id);
      if (!stored) return { ok: false, reason: 'not-found' };
      if (stored.status !== 'open') return { ok: false, reason: 'unavailable' };
      if (stored.voters.has(visitorId)) return { ok: false, reason: 'already-voted' };

      const at = now();
      if (!windowOk(votedAt, MAX_VOTES_PER_WINDOW, at)) {
        return { ok: false, reason: 'rate-limited' };
      }

      stored.voters.add(visitorId);
      stored.votes += 1;
      stored.lastVotedAt = at;
      votedAt.push(at);
      share();
      return { ok: true, request: present(stored) };
    },

    async markPlayed(id) {
      const stored = rows.get(id);
      if (!stored) return null;
      stored.status = 'played';
      stored.playedAt = now();
      share();
      return present(stored);
    },

    subscribe(listener) {
      listeners.add(listener);
      // Ask once — an already-open tab replies with its snapshot.
      channel?.postMessage({ type: 'hello' } satisfies ChannelMessage);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let shared: RequestApi | null = null;

/** App-wide community board for this session. */
export function getRequestApi(): RequestApi {
  if (!shared) shared = createLocalRequestApi();
  return shared;
}
