import { randomId } from './id';

/**
 * The anonymous device identity the community wall writes with.
 *
 * Two honest, separate jobs:
 *
 *  1. `visitorToken()` — the random, non-identifying id the database stores
 *     on INSERTs so it can rate-limit and enforce one vote per visitor. It
 *     travels *with writes only*: no public SELECT policy or column grant
 *     ever returns it, so it is never read back off the wire.
 *  2. "Have I voted?" — remembered *on this device* as a list of request ids.
 *     The vote COUNT itself always comes from the database aggregate
 *     (`suggestion_vote_counts`); this list only colours the button.
 *
 * Storage failures (SSR, private browsing, quota) degrade to an in-memory
 * identity: the wall still works, votes simply don't survive a reload.
 * Nothing here identifies a person — no cookies, no accounts, no sync.
 */

const TOKEN_KEY = 'nostalgia-visitor-id';
const VOTED_KEY = 'nostalgia-voted-requests';
/** Keep the list bounded — it is device memory, not an archive. */
const VOTED_CAP = 300;

const memory = { token: '', voted: null as Set<string> | null };

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

const readVoted = (): Set<string> => {
  const store = storage();
  if (!store) {
    memory.voted ??= new Set<string>();
    return memory.voted;
  }
  try {
    const raw = store.getItem(VOTED_KEY);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set<string>();
  }
};

export function hasVoted(requestId: string): boolean {
  return readVoted().has(requestId);
}

export function markVoted(requestId: string): void {
  const store = storage();
  const ids = readVoted();
  ids.delete(requestId); // newest first
  const next = [requestId, ...ids].slice(0, VOTED_CAP);
  memory.voted = new Set(next);
  if (!store) return;
  try {
    store.setItem(VOTED_KEY, JSON.stringify(next));
  } catch {
    // Quota/private mode: this session's memory copy above still holds.
  }
}
