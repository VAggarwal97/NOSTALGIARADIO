import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasVoted, markVoted, visitorToken } from '../src/lib/community-identity';
import {
  createDeferredRequestApi,
  createLocalRequestApi,
  createSharedRequestApi,
  shouldUseSharedDatabase,
  usesSharedDatabase,
} from '../src/lib/request-api';
import type { RequestApi, SongRequest, TrackMeta } from '../src/lib/request-api';
import { createSupabaseRequestApi } from '../src/lib/supabase-request-api';
import type { WallIdentity } from '../src/lib/supabase-request-api';
import { WallQueryError } from '../src/lib/wall-store';
import type { NewSuggestion, WallRow, WallStore } from '../src/lib/wall-store';

/**
 * The public wiring round — Supabase behind the existing RequestApi seam:
 *
 *  1. Backend selection is guarded: no browser or no publishable pair keeps
 *     the site on the local store (SSR/smoke never touch a network).
 *  2. The Supabase adapter obeys the same contract as V1 — success only after
 *     the store confirms, counts only from the store, `mine` only from device
 *     memory, failures re-thrown instead of faked.
 *  3. What the browser may send/never reads is pinned: no `status` on insert,
 *     no `visitor_token` in any select, no stored counts, no public UPDATE.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const wiring = read('../supabase/migrations/20260930000005_public_wiring.sql');
const rateLimits = read('../supabase/migrations/20260930000006_definer_rate_limits.sql');

const yt = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
const ytId = (index: number): string => `${String(index).padStart(2, '0')}${'a'.repeat(9)}`;

const meta = (title: string, artist = 'Test Artist', artwork: string | null = null): TrackMeta => ({
  title,
  artist,
  artwork,
});

const iso = (at: number): string => new Date(at).toISOString();

/* ── The store seam: an in-memory double that enforces the same rules ────── */

type FaultKey = 'board' | 'list' | 'byId' | 'bySong' | 'insertSuggestion' | 'insertVote';

interface FakeWall {
  store: WallStore;
  rows: Map<string, WallRow>;
  ballots: Array<{ suggestion_id: string; visitor_token: string; at: number }>;
  submitted: NewSuggestion[];
  fault: Partial<Record<FaultKey, Error>>;
}

const makeRow = (
  spec: { id: string; provider_id: string; title: string } & Partial<WallRow>,
): WallRow => ({
  id: spec.id,
  song_url: spec.song_url ?? `https://www.youtube.com/watch?v=${spec.provider_id}`,
  provider: spec.provider ?? 'youtube',
  provider_id: spec.provider_id,
  title: spec.title,
  artist: spec.artist ?? 'Test Artist',
  artwork_url: spec.artwork_url ?? null,
  station_id: spec.station_id ?? null,
  status: spec.status ?? 'approved',
  played_at: spec.played_at ?? null,
  created_at: spec.created_at ?? iso(1_000_000),
  updated_at: spec.updated_at ?? spec.created_at ?? iso(1_000_000),
  votes: 0, // never stored — recomputed on every read, like the real view
  last_voted_at: null,
});

const createFakeWall = (now: () => number): FakeWall => {
  const rows = new Map<string, WallRow>();
  const ballots: FakeWall['ballots'] = [];
  const submitted: NewSuggestion[] = [];
  const fault: FakeWall['fault'] = {};

  const take = (key: FaultKey): void => {
    const error = fault[key];
    if (error) {
      fault[key] = undefined;
      throw error;
    }
  };

  const counts = (id: string): { votes: number; last: string | null } => {
    const mine = ballots.filter((ballot) => ballot.suggestion_id === id);
    return {
      votes: mine.length,
      last: mine.length > 0 ? iso(Math.max(...mine.map((ballot) => ballot.at))) : null,
    };
  };

  const merged = (row: WallRow): WallRow => {
    const { votes, last } = counts(row.id);
    return { ...row, votes, last_voted_at: last };
  };

  const visible = (row: WallRow): boolean => row.status === 'approved' || row.status === 'played';

  const store: WallStore = {
    async board(tab, query, limit) {
      take('board');
      const needle = query.trim().toLowerCase();
      const matches = (row: WallRow) =>
        !needle ||
        row.title.toLowerCase().includes(needle) ||
        (row.artist ?? '').toLowerCase().includes(needle);
      const votesOf = (row: WallRow): number => counts(row.id).votes;
      let list = [...rows.values()]
        .filter((row) => {
          if (tab === 'played') return row.status === 'played';
          if (row.status !== 'approved') return false;
          if (tab === 'rising') return counts(row.id).last !== null;
          return true;
        })
        .filter(matches);
      if (tab === 'recent') {
        list = list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      } else if (tab === 'played') {
        list = list.sort((a, b) => (b.played_at ?? '').localeCompare(a.played_at ?? ''));
      } else if (tab === 'rising') {
        list = list.sort(
          (a, b) =>
            (counts(b.id).last ?? '').localeCompare(counts(a.id).last ?? '') ||
            votesOf(b) - votesOf(a) ||
            a.created_at.localeCompare(b.created_at),
        );
      } else {
        list = list.sort(
          (a, b) => votesOf(b) - votesOf(a) || a.created_at.localeCompare(b.created_at),
        );
      }
      return list.slice(0, limit).map(merged);
    },

    async list(limit) {
      take('list');
      return [...rows.values()]
        .filter(visible)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map(merged);
    },

    async byId(id) {
      take('byId');
      const row = rows.get(id);
      return row && visible(row) ? merged(row) : null; // RLS: hidden rows don't exist
    },

    async bySong(provider, providerId) {
      take('bySong');
      for (const row of rows.values()) {
        if (row.provider === provider && row.provider_id === providerId && visible(row)) {
          return merged(row);
        }
      }
      return null;
    },

    async insertSuggestion(payload) {
      take('insertSuggestion');
      for (const row of rows.values()) {
        if (row.provider === payload.provider && row.provider_id === payload.provider_id) {
          throw new WallQueryError(
            '23505',
            'duplicate key value violates unique constraint "suggestions_one_per_song"',
          );
        }
      }
      const at = now();
      const row = makeRow({
        id: `req-${rows.size + 1}`,
        provider: payload.provider,
        provider_id: payload.provider_id,
        song_url: payload.song_url,
        title: payload.title,
        artist: payload.artist,
        artwork_url: payload.artwork_url,
        station_id: payload.station_id,
        created_at: iso(at),
      });
      rows.set(row.id, row);
      submitted.push(payload);
      return { ...row, votes: 0, last_voted_at: null };
    },

    async insertVote(suggestionId, token) {
      take('insertVote');
      const row = rows.get(suggestionId);
      if (!row || row.status !== 'approved') {
        throw new WallQueryError(
          '42501',
          'new row violates row-level security policy for table "votes"',
        );
      }
      if (ballots.some((b) => b.suggestion_id === suggestionId && b.visitor_token === token)) {
        throw new WallQueryError(
          '23505',
          'duplicate key value violates unique constraint "votes_one_per_suggestion"',
        );
      }
      ballots.push({ suggestion_id: suggestionId, visitor_token: token, at: now() });
    },
  };

  return { store, rows, ballots, submitted, fault };
};

const makeIdentity = (token: string): WallIdentity & { voted: Set<string> } => {
  const voted = new Set<string>();
  return {
    token: () => token,
    hasVoted: (id) => voted.has(id),
    markVoted: (id) => {
      voted.add(id);
    },
    voted,
  };
};

/* ── Selection guards ────────────────────────────────────────────────────── */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('backend selection — local unless a configured browser asks', () => {
  it('never uses the database without a browser (SSR, smoke, Node stay local)', () => {
    expect(typeof window).toBe('undefined'); // vitest: no DOM unless stubbed
    expect(usesSharedDatabase()).toBe(false);
    expect(usesSharedDatabase()).toBe(false); // idempotent, no hidden state
  });

  it('switches only for a configured, non-SSR browser (pure decision)', () => {
    const browser = { ssr: false, hasWindow: true, configured: true };
    expect(shouldUseSharedDatabase(browser)).toBe(true);
    expect(shouldUseSharedDatabase({ ...browser, ssr: true })).toBe(false); // SSR wins
    expect(shouldUseSharedDatabase({ ...browser, hasWindow: false })).toBe(false); // Node
    expect(shouldUseSharedDatabase({ ...browser, configured: false })).toBe(false); // offline
    expect(
      shouldUseSharedDatabase({ ssr: true, hasWindow: false, configured: false }),
    ).toBe(false);
  });

  it('is false in tests/Node even if a configured pair exists', () => {
    vi.stubGlobal('window', undefined); // explicit: no browser here
    expect(usesSharedDatabase()).toBe(false);
  });

  it('falls back to a fully local board when unconfigured', async () => {
    const api = createSharedRequestApi();
    expect(await api.board({ tab: 'wanted' })).toEqual([]);
    expect(await api.list()).toEqual([]);
  });

  it('defers the database chunk: calls forward, subscribers are ref-counted', async () => {
    const backend = createLocalRequestApi();
    const loader = vi.fn(async () => backend);
    const api = createDeferredRequestApi(loader);
    expect(loader).not.toHaveBeenCalled(); // nothing loads until first use

    const listener = vi.fn();
    const stop = api.subscribe(listener);
    await new Promise((resolve) => setTimeout(resolve, 0)); // attach resolves
    expect(loader).toHaveBeenCalledOnce();

    const submitted = await api.submit({
      url: yt('dQw4w9WgXcQ'),
      meta: meta('Never Gonna Give You Up'),
      stationId: null,
    });
    expect(submitted.ok).toBe(true);
    expect(listener).toHaveBeenCalled(); // forwarded from the real backend

    stop();
    const before = listener.mock.calls.length;
    await api.submit({
      url: yt(ytId(1)),
      meta: meta('Another Song'),
      stationId: null,
    });
    expect(listener.mock.calls.length).toBe(before); // unsubscribed
  });

  it('propagates a failed load as a rejected call — never a silent success', async () => {
    const api = createDeferredRequestApi(async () => {
      throw new Error('backend unavailable');
    });
    await expect(api.list()).rejects.toThrow('backend unavailable');
  });
});

/* ── Device identity ─────────────────────────────────────────────────────── */

describe('device identity — token writes, memory keeps `mine`', () => {
  it('keeps one stable token and a local voted list without storage', () => {
    const token = visitorToken();
    expect(token.length).toBeGreaterThan(0);
    expect(visitorToken()).toBe(token);

    markVoted('req-memory');
    expect(hasVoted('req-memory')).toBe(true);
    expect(hasVoted('req-never')).toBe(false);
  });

  it('persists both to storage when available and survives corrupted data', () => {
    const jar = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => jar.get(key) ?? null,
        setItem: (key: string, value: string) => void jar.set(key, String(value)),
        removeItem: (key: string) => void jar.delete(key),
      },
    });

    const token = visitorToken();
    expect(jar.get('nostalgia-visitor-id')).toBe(token);

    jar.set('nostalgia-voted-requests', '{not json');
    expect(() => markVoted('req-9')).not.toThrow();
    expect(hasVoted('req-9')).toBe(true);
    expect(JSON.parse(jar.get('nostalgia-voted-requests') ?? 'null')).toEqual(['req-9']);
  });
});

/* ── The adapter over the store seam ─────────────────────────────────────── */

describe('supabase request api — the V1 contract over a store', () => {
  const setup = (token = 'visitor-a') => {
    let clock = 1_000_000;
    const now = () => clock;
    const db = createFakeWall(now);
    const who = makeIdentity(token);
    const api = createSupabaseRequestApi(db.store, { identity: who, pollMs: 0, now });
    return { db, api, who, tick: (ms: number) => void (clock += ms) };
  };

  const seed = async (
    api: RequestApi,
    index: number,
    title: string,
    artist = 'Test Artist',
  ): Promise<SongRequest | null> => {
    const result = await api.submit({
      url: yt(ytId(index)),
      meta: meta(title, artist),
      stationId: null,
    });
    expect(result.ok).toBe(true);
    return result.ok ? result.request : null;
  };

  it('starts from an honest empty state', async () => {
    const { api } = setup();
    expect(await api.list()).toEqual([]);
    expect(await api.board({ tab: 'wanted' })).toEqual([]);
    expect(await api.board({ tab: 'played' })).toEqual([]);
    expect(await api.find(yt('dQw4w9WgXcQ'))).toBeNull();
    expect(await api.get('missing')).toBeNull();
  });

  it('refuses hollow metadata before any network call', async () => {
    const { api, db } = setup();
    expect(
      await api.submit({
        url: yt('dQw4w9WgXcQ'),
        meta: { title: '   ', artist: 'Someone', artwork: null },
        stationId: null,
      }),
    ).toEqual({ ok: false, reason: 'invalid-meta' });
    expect(await api.submit({ url: 'https://example.com/x', meta: meta('X'), stationId: null })).toEqual({
      ok: false,
      reason: 'invalid-url',
    });
    expect(db.submitted).toEqual([]);
  });

  it('clamps metadata and never lets the browser dictate a status', async () => {
    const { api, db } = setup();
    const result = await api.submit({
      url: yt('dQw4w9WgXcQ'),
      meta: {
        title: 'T'.repeat(500),
        artist: 'A'.repeat(300),
        artwork: 'javascript:alert(1)',
      },
      stationId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.title).toHaveLength(160);
    expect(result.request.artist).toHaveLength(120);
    expect(result.request.artwork).toBeNull();

    expect(db.submitted).toHaveLength(1);
    const payload = db.submitted[0];
    expect(payload).not.toHaveProperty('status'); // the column default decides
    expect(Object.keys(payload).sort()).toEqual([
      'artist',
      'artwork_url',
      'provider',
      'provider_id',
      'song_url',
      'station_id',
      'title',
      'visitor_token',
    ]);
    expect(payload.visitor_token).toBe('visitor-a');
  });

  it('maps duplicate and rate-limit signals to the wall vocabulary', async () => {
    const { api, db } = setup();
    expect(await seed(api, 0, 'Alpha')).not.toBeNull();

    // The same song again → the unique index answers, no second row exists.
    const duplicate = await api.submit({
      url: yt(ytId(0)),
      meta: meta('Alpha again'),
      stationId: null,
    });
    expect(duplicate).toEqual({ ok: false, reason: 'duplicate' });
    expect(db.submitted).toHaveLength(1); // the refused insert never reached the store

    db.fault.insertSuggestion = new WallQueryError(
      'P0001',
      'rate-limited: at most 3 suggestions per minute',
    );
    const limited = await api.submit({ url: yt(ytId(1)), meta: meta('Beta'), stationId: null });
    expect(limited).toEqual({ ok: false, reason: 'rate-limited' });

    db.fault.insertSuggestion = new Error('fetch failed');
    await expect(
      api.submit({ url: yt(ytId(2)), meta: meta('Gamma'), stationId: null }),
    ).rejects.toThrow('fetch failed'); // honest outage, never a fake success
  });

  it('counts votes in the store — once per device, never in the browser', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const db = createFakeWall(now);
    const first = createSupabaseRequestApi(db.store, {
      identity: makeIdentity('visitor-a'),
      pollMs: 0,
      now,
    });
    const second = createSupabaseRequestApi(db.store, {
      identity: makeIdentity('visitor-b'),
      pollMs: 0,
      now,
    });

    const request = await (async () => {
      const result = await first.submit({
        url: yt(ytId(0)),
        meta: meta('Never Gonna Give You Up'),
        stationId: null,
      });
      expect(result.ok).toBe(true);
      return result.ok ? result.request : null;
    })();
    expect(request?.votes).toBe(0);
    expect(request?.mine).toBe(false);

    clock = 2_000;
    const vote = await first.vote(request!.id);
    expect(vote.ok).toBe(true);
    if (vote.ok) {
      expect(vote.request.votes).toBe(1);
      expect(vote.request.mine).toBe(true);
    }
    expect(await first.vote(request!.id)).toEqual({ ok: false, reason: 'already-voted' });
    expect(db.ballots).toHaveLength(1); // the retry never inflated anything

    clock = 2_200;
    const fromOther = await second.vote(request!.id);
    expect(fromOther.ok).toBe(true);
    if (fromOther.ok) expect(fromOther.request.votes).toBe(2);
    expect((await first.get(request!.id))?.votes).toBe(2);
    expect((await second.get(request!.id))?.mine).toBe(true);
  });

  it('maps every vote refusal to an honest reason', async () => {
    const { api, db } = setup();
    const request = await seed(api, 0, 'Alpha');

    db.fault.insertVote = new WallQueryError(
      '42501',
      'new row violates row-level security policy for table "votes"',
    );
    expect(await api.vote(request!.id)).toEqual({ ok: false, reason: 'unavailable' });

    db.fault.insertVote = new WallQueryError('23503', 'violates foreign key constraint');
    expect(await api.vote(request!.id)).toEqual({ ok: false, reason: 'not-found' });

    db.fault.insertVote = new WallQueryError(
      'P0001',
      'rate-limited: at most 10 votes per minute',
    );
    expect(await api.vote(request!.id)).toEqual({ ok: false, reason: 'rate-limited' });

    db.fault.insertVote = new Error('network down');
    await expect(api.vote(request!.id)).rejects.toThrow('network down');
    expect(db.ballots).toHaveLength(0); // no refusal was ever mistaken for a vote
  });

  it('rankings come from the store, mirroring the local rules', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const db = createFakeWall(now);
    const a = createSupabaseRequestApi(db.store, {
      identity: makeIdentity('visitor-a'),
      pollMs: 0,
      now,
    });
    const b = createSupabaseRequestApi(db.store, {
      identity: makeIdentity('visitor-b'),
      pollMs: 0,
      now,
    });

    clock = 1_000;
    const alpha = await seed(a, 0, 'Alpha');
    clock = 2_000;
    const beta = await seed(a, 1, 'Beta');
    clock = 3_000;
    const gamma = await seed(a, 2, 'Gamma');

    clock = 4_000;
    await a.vote(alpha!.id);
    clock = 5_000;
    await a.vote(gamma!.id);
    clock = 6_000;
    await b.vote(beta!.id);
    clock = 7_000;
    await a.vote(beta!.id); // Beta leads with two votes

    const wanted = await a.board({ tab: 'wanted' });
    expect(wanted.map((r) => r.title)).toEqual(['Beta', 'Alpha', 'Gamma']);

    // RISING follows the freshest voting activity, not lifetime totals.
    const rising = await a.board({ tab: 'rising' });
    expect(rising[0].title).toBe('Beta');
    clock = 9_000;
    await seed(a, 3, 'Gamma fresh'); // never voted → not rising
    const risingNow = await a.board({ tab: 'rising' });
    expect(risingNow.map((r) => r.title)).not.toContain('Gamma fresh');

    // PLAYED is history-only, newest airplay first.
    clock = 10_000;
    await a.markPlayed(alpha!.id, alpha!);
    const played = await a.board({ tab: 'played' });
    expect(played.map((r) => r.title)).toEqual(['Alpha']);
    expect(played[0].status).toBe('played');
    expect(played[0].playedAt).toBe(10_000);
    const wantedAfter = await a.board({ tab: 'wanted' });
    expect(wantedAfter.map((r) => r.title)).not.toContain('Alpha');
  });

  it('search runs against the store and stays inside the tab', async () => {
    const { api } = setup();
    await api.submit({
      url: yt(ytId(0)),
      meta: meta('Neon Streets', 'The Night Riders'),
      stationId: null,
    });
    const second = await api.submit({
      url: yt(ytId(1)),
      meta: meta('Old Market', 'Baul Bhavan'),
      stationId: null,
    });

    expect(await api.board({ tab: 'wanted', query: 'nEON' })).toHaveLength(1);
    expect(await api.board({ tab: 'wanted', query: 'night riders' })).toHaveLength(1);
    expect(await api.board({ tab: 'wanted', query: 'nothing-like-this' })).toEqual([]);

    if (second.ok) await api.markPlayed(second.request.id, second.request);
    expect(await api.board({ tab: 'wanted', query: 'Old Market' })).toEqual([]);
    expect(await api.board({ tab: 'played', query: 'old market' })).toHaveLength(1);
  });

  it('retires an aired request to this session without touching the database', async () => {
    const { api, db } = setup();
    const request = await seed(api, 0, 'Alpha');
    expect(request).not.toBeNull();

    const retired = await api.markPlayed(request!.id, request!);
    expect(retired?.status).toBe('played');
    expect(db.rows.get(request!.id)?.status).toBe('approved'); // no public UPDATE exists

    expect((await api.board({ tab: 'wanted' })).map((r) => r.id)).not.toContain(request!.id);
    const played = await api.board({ tab: 'played' });
    expect(played.map((r) => r.id)).toContain(request!.id);
    expect((await api.get(request!.id))?.status).toBe('played');
    expect((await api.find(yt(ytId(0))))?.status).toBe('played');
    expect((await api.list()).map((r) => r.status)).toContain('played');

    // History is not votable — refused before any write is attempted.
    expect(await api.vote(request!.id)).toEqual({ ok: false, reason: 'unavailable' });
    expect(db.ballots).toHaveLength(0);
  });

  it('still retires offline when the caller passes the request it played', async () => {
    const { api, db } = setup();
    const request = await seed(api, 0, 'Alpha');
    db.fault.byId = new Error('offline');
    const retired = await api.markPlayed(request!.id, request!);
    expect(retired?.status).toBe('played');
    expect((await api.board({ tab: 'played' })).map((r) => r.id)).toContain(request!.id);
    expect(await api.markPlayed('does-not-exist')).toBeNull();
  });

  it('notifies subscribers on every mutation, then stops', async () => {
    const { api } = setup();
    const listener = vi.fn();
    const stop = api.subscribe(listener);

    const first = await seed(api, 0, 'Alpha');
    expect(listener).toHaveBeenCalledTimes(1);

    await api.vote(first!.id);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    await api.markPlayed(first!.id, first!);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);

    stop();
    const settled = listener.mock.calls.length;
    await seed(api, 1, 'Beta');
    expect(listener.mock.calls.length).toBe(settled); // unsubscribed
  });

  it('lists newest first across every public status', async () => {
    const { api, tick } = setup();
    const first = await seed(api, 0, 'First');
    tick(1_000);
    const second = await seed(api, 1, 'Second');
    tick(1_000);
    const third = await seed(api, 2, 'Third');

    expect((await api.list()).map((r) => r.title)).toEqual(['Third', 'Second', 'First']);
    await api.markPlayed(second!.id, second!);
    expect((await api.list()).map((r) => r.id)).toEqual([
      third!.id,
      second!.id,
      first!.id,
    ]);
  });
});

/* ── Migration 5 invariants ──────────────────────────────────────────────── */

describe('migration 5 — the wiring stays inside the security model', () => {
  it('defaults new public requests to visible-and-votable (seamless)', () => {
    expect(wiring).toContain(
      "alter table public.suggestions alter column status set default 'approved'",
    );
    expect(wiring).toContain("status in ('pending', 'approved')");
    expect(wiring).toContain('visitor_token is not null');
    expect(wiring).toContain('drop policy if exists "public submits pending requests"');
  });

  it('adds no public UPDATE, DELETE or new token read', () => {
    expect(wiring).not.toMatch(/for\s+update/i);
    expect(wiring).not.toMatch(/for\s+delete/i);
    expect(wiring).not.toMatch(/grant\s+select[^\n]*on\s+public\.votes/i);
    expect(wiring).not.toMatch(/add column[^\n]*votes/i); // counts stay aggregates
  });

  it('publishes suggestions for realtime — and never the votes table', () => {
    expect(wiring).toContain('alter publication supabase_realtime add table public.suggestions');
    expect(wiring).not.toContain('realtime add table public.votes');
    expect(wiring).toContain('pg_publication_tables'); // guarded, re-runnable
  });

  it('runs the board query as definer with a pinned search_path and a clamped limit', () => {
    expect(wiring).toMatch(
      /create or replace function public\.wall_board[\s\S]*?security definer[\s\S]*?set search_path = public, pg_temp/,
    );
    expect(wiring).toContain('limit least(greatest(coalesce(p_limit, 60), 1), 60)');
    expect(wiring).toContain('revoke execute on function public.wall_board');
    expect(wiring).toMatch(
      /grant execute on function public\.wall_board\(text, text, integer\)\s*\n?\s*to anon, authenticated, service_role/,
    );
  });

  it('hardcodes public visibility inside the function and leaks no token', () => {
    const body =
      wiring.match(/as \$\$\n([\s\S]*?)\n\$\$;\n\ncomment on function public\.wall_board/)?.[1] ??
      '';
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("s.status = 'played'");
    expect(body).toContain("s.status = 'approved'");
    expect(body).not.toContain('visitor_token');
    expect(body).not.toContain('rejected'); // hidden rows stay hidden here too
  });
});

/* ── Environment parity & source hygiene ─────────────────────────────────── */

describe('public wiring sources — shared config, no secrets', () => {
  const publicSources = [
    'src/lib/supabase-env.ts',
    'src/lib/supabase-wall-store.ts',
    'src/lib/supabase-request-api.ts',
    'src/lib/wall-store.ts',
    'src/lib/community-identity.ts',
    'src/lib/request-api.ts',
  ].map((file) => ({ file, text: read(`../${file}`) }));

  it('reads the same environment pair as the admin client', () => {
    const admin = read('../src/admin/supabaseClient.ts');
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
      expect(admin).toContain(name);
      expect(publicSources[0].text).toContain(name);
    }
  });

  it('never references a service-role key', () => {
    for (const { file, text } of publicSources) {
      expect(text, file).not.toMatch(/service_role|SERVICE_ROLE/);
    }
  });

  it('selects only the token-free column grant, never visitor_token', () => {
    const store = read('../src/lib/supabase-wall-store.ts');
    const columns = store.match(/const PUBLIC_COLUMNS =([\s\S]*?);/)?.[1] ?? '';
    expect(columns.length).toBeGreaterThan(0);
    expect(columns).not.toContain('visitor_token');
    expect(columns).not.toContain('status ='); // reads never dictate states
  });
});

/* ── Rate-limit triggers: owner counters, zero new public surface ────────── */

describe('rate-limit migration — counters run as definer, tokens stay hidden', () => {
  const bodyOf = (fn: string): string =>
    rateLimits.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?\\n\\$\\$;`))?.[0] ?? '';

  it('replaces both counters with security definer and a pinned search_path', () => {
    for (const fn of ['enforce_suggestion_rate', 'enforce_vote_rate']) {
      const body = bodyOf(fn);
      expect(body.length, fn).toBeGreaterThan(0);
      expect(body, fn).toContain('security definer');
      expect(body, fn).toContain('set search_path = public, pg_temp');
      expect(body, fn).toContain('visitor_token'); // the count that anon may not run
      expect(body, fn).toContain("errcode = 'P0001'"); // still the mapped rate-limit signal
    }
  });

  it('grants the browser no new privilege — tokens keep having no public SELECT', () => {
    // only executable statements count; the header comments quote the old hint
    const executable = rateLimits
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bgrant\b/i); // a fix, not a grant widening
    expect(executable).not.toMatch(/alter\s+default\s+privileges/i);
  });
});
