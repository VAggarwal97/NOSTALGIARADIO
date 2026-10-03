/**
 * Live presence — approximate active sessions, never a fabricated number.
 *
 * Two transports implement one `PresenceApi`:
 *
 *  - global: Supabase Realtime presence (supabase-presence-store.ts) counts
 *    every connected visitor when the project is configured;
 *  - local:  a BroadcastChannel tally of this browser's tabs — the fallback
 *    when Supabase is unconfigured, unreachable or slow (see getPresence).
 *
 * Either way the count is a real transport's answer, never invented. No keys
 * live in this repo, and presence is decoration: it never gates rendering,
 * first paint or playback.
 */

/** Approximate set of live sessions, derived from heartbeat timestamps. */
export class SessionTally {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  touch(id: string): void {
    this.seen.set(id, this.now());
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  remove(id: string): void {
    this.seen.delete(id);
  }

  /** Drop sessions that missed their heartbeats. True when the count changed. */
  prune(ttlMs: number): boolean {
    const before = this.seen.size;
    const cutoff = this.now() - ttlMs;
    for (const [id, seenAt] of this.seen) {
      if (seenAt < cutoff) this.seen.delete(id);
    }
    return this.seen.size !== before;
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface PresenceApi {
  /** Calls back with the current session count, then again on every change. */
  subscribe(listener: (sessions: number) => void): () => void;
  /** Stop heartbeats and leave the channel (idempotent). */
  close(): void;
}

const CHANNEL = 'nostalgia-radio-presence';
const HEARTBEAT_MS = 5000;
const TTL_MS = 15000;

type PresenceMessage = { kind: 'beat'; id: string } | { kind: 'bye'; id: string };

/**
 * Local presence over BroadcastChannel. Falls back to a tally of one
 * (this session) when the browser has no channel support.
 */
export function createLocalPresence(): PresenceApi {
  const listeners = new Set<(sessions: number) => void>();
  const tally = new SessionTally();
  const self = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  // This session is real from the moment the channel exists — even before
  // (or without) a transport, the count can never claim zero listeners.
  tally.touch(self);

  let channel: BroadcastChannel | null = null;
  let running = false;
  let heartbeat = 0;
  let janitor = 0;
  let lastReported = -1;

  const emit = () => {
    if (tally.size === lastReported) return;
    lastReported = tally.size;
    for (const listener of listeners) listener(tally.size);
  };

  const post = (message: PresenceMessage) => {
    try {
      channel?.postMessage(message);
    } catch {
      /* channel closed — the count simply stops updating */
    }
  };

  const leave = () => {
    post({ kind: 'bye', id: self });
  };

  const start = () => {
    if (running || typeof window === 'undefined') return;
    running = true;
    tally.touch(self);
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(CHANNEL);
      } catch {
        channel = null;
      }
    }
    channel?.addEventListener('message', (event: MessageEvent<PresenceMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
      if (message.kind === 'bye') {
        tally.remove(message.id);
      } else if (message.kind === 'beat') {
        const firstSighting = !tally.has(message.id);
        tally.touch(message.id);
        // Answer a newcomer's first beat once so both sides count up fast —
        // the `firstSighting` guard keeps the reply from pinging forever.
        if (firstSighting) post({ kind: 'beat', id: self });
      }
      emit();
    });
    post({ kind: 'beat', id: self });
    heartbeat = window.setInterval(() => {
      tally.touch(self);
      post({ kind: 'beat', id: self });
    }, HEARTBEAT_MS);
    janitor = window.setInterval(() => {
      tally.touch(self);
      if (tally.prune(TTL_MS)) emit();
    }, HEARTBEAT_MS);
    window.addEventListener('pagehide', leave);
    emit();
  };

  const stop = () => {
    if (!running) return;
    running = false;
    if (heartbeat) window.clearInterval(heartbeat);
    if (janitor) window.clearInterval(janitor);
    heartbeat = 0;
    janitor = 0;
    window.removeEventListener('pagehide', leave);
    leave();
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
    channel = null;
    lastReported = -1;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      listener(tally.size);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    close: stop,
  };
}

/** How long the global transport gets to answer before the local tally takes over. */
const REMOTE_READY_MS = 3000;

/**
 * Prefer the global Supabase presence (every visitor counts); fall back to
 * the local channel when Supabase is unconfigured, unreachable or slow to
 * answer. Listeners hear one honest number whenever a transport speaks —
 * and nothing at all while none does (the UI already renders `null`).
 */
function createPreferRemotePresence(): PresenceApi {
  const listeners = new Set<(sessions: number) => void>();
  let backend: PresenceApi | null = null;
  let backendUnsub: (() => void) | null = null;
  let reported: number | null = null;
  let pending = false;
  let closed = false;
  let graceTimer = 0;

  const clearGrace = (): void => {
    if (graceTimer) {
      window.clearTimeout(graceTimer);
      graceTimer = 0;
    }
  };

  const attach = (next: PresenceApi): void => {
    if (closed) {
      next.close();
      return;
    }
    backend = next;
    backendUnsub = next.subscribe((sessions) => {
      reported = sessions;
      for (const listener of [...listeners]) listener(sessions);
    });
  };

  const swapToLocal = (): void => {
    if (!listeners.size || closed) return;
    const previous = backend;
    const previousUnsub = backendUnsub;
    backend = null;
    backendUnsub = null;
    reported = null;
    previousUnsub?.();
    previous?.close();
    attach(createLocalPresence());
  };

  const attachLocalOrNothing = (): void => {
    if (backend || closed || !listeners.size) return;
    attach(createLocalPresence());
  };

  const tryRemote = (): void => {
    if (pending || backend || closed || typeof window === 'undefined') return;
    pending = true;
    void import('./supabase-presence-store')
      .then((module) => module.createBrowserPresence())
      .then((remote) => {
        pending = false;
        if (closed || !listeners.size) {
          remote?.close();
          return;
        }
        if (!remote) {
          attachLocalOrNothing(); // Supabase not configured → local tally
          return;
        }
        attach(remote);
        // A configured backend that never syncs (blocked websocket…) must not
        // leave a permanently blank counter: the local channel takes over.
        clearGrace();
        graceTimer = window.setTimeout(() => {
          graceTimer = 0;
          if (reported === null) swapToLocal();
        }, REMOTE_READY_MS);
      })
      .catch(() => {
        pending = false;
        attachLocalOrNothing();
      });
  };

  const teardown = (): void => {
    clearGrace();
    backendUnsub?.();
    backend?.close();
    backend = null;
    backendUnsub = null;
    reported = null;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      tryRemote();
      if (reported !== null) listener(reported);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) teardown();
      };
    },
    close() {
      closed = true;
      listeners.clear();
      teardown();
    },
  };
}

let shared: PresenceApi | null = null;

/**
 * App-wide presence channel — created on first use, never during SSR.
 * Global (Supabase realtime) when configured, this device's tabs otherwise.
 */
export function getPresence(): PresenceApi {
  if (!shared) shared = createPreferRemotePresence();
  return shared;
}
