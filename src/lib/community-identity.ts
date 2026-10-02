import { randomId } from './id';

/**
 * The anonymous device identity the community wall writes with.
 *
 * Two honest, separate jobs:
 *
 *  1. `visitorToken()` — the random, non-identifying id the database stores
 *     on INSERTs so it can rate-limit and enforce one vote / one like per
 *     visitor. It travels *with writes only*: no public SELECT policy or
 *     column grant ever returns it, so it is never read back off the wire.
 *  2. "Have I voted / liked?" — remembered *on this device* as two lists of
 *     request ids. The COUNTS themselves always come from the database
 *     aggregates (`suggestion_vote_counts`, `song_like_counts`); these lists
 *     only colour the buttons.
 *
 * Storage failures (SSR, private browsing, quota) degrade to an in-memory
 * identity: the wall still works, votes and likes simply don't survive a
 * reload. Nothing here identifies a person — no cookies, no accounts, no sync.
 */

const TOKEN_KEY = 'nostalgia-visitor-id';
const VOTED_KEY = 'nostalgia-voted-requests';
const LIKED_KEY = 'nostalgia-liked-requests';
/** Keep the lists bounded — they are device memory, not an archive. */
const LIST_CAP = 300;

const memory = {
  token: '',
  lists: {} as Record<string, Set<string> | undefined>,
};

const storage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null; // storage access itself can throw (privacy settings)
  }
};

/** Stable per browser, ≤ 100 chars to satisfy the database CHECK. */
export function visitorToken(): string {
  const store = storage();
  if (!store) {
    if (!memory.token) memory.token = randomId();
    return memory.token;
  }
  try {
    const existing = store.getItem(TOKEN_KEY);
    if (existing && existing.length > 0 && existing.length <= 100) return existing;
    const fresh = randomId();
    store.setItem(TOKEN_KEY, fresh);
    return fresh;
  } catch {
    if (!memory.token) memory.token = randomId();
    return memory.token;
  }
}

const readList = (key: string): Set<string> => {
  const store = storage();
  if (!store) {
    memory.lists[key] ??= new Set<string>();
    return memory.lists[key];
  }
  try {
    const raw = store.getItem(key);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set<string>();
  }
};

const rememberInList = (key: string, id: string): void => {
  const store = storage();
  const ids = readList(key);
  ids.delete(id); // newest first
  const next = [id, ...ids].slice(0, LIST_CAP);
  memory.lists[key] = new Set(next);
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(next));
  } catch {
    // Quota/private mode: this session's memory copy above still holds.
  }
};

export function hasVoted(requestId: string): boolean {
  return readList(VOTED_KEY).has(requestId);
}

export function markVoted(requestId: string): void {
  rememberInList(VOTED_KEY, requestId);
}

export function hasLiked(requestId: string): boolean {
  return readList(LIKED_KEY).has(requestId);
}

export function markLiked(requestId: string): void {
  rememberInList(LIKED_KEY, requestId);
}
