import { describe, expect, it, vi } from 'vitest';

import { createLocalRequestApi, createRequestStore, getRequestApi } from '../src/lib/request-api';
import type { TrackMeta } from '../src/lib/request-api';
import { resolveTrackMeta } from '../src/lib/track-meta';
import { requestIdFromSearch, routeFromPathname, shareHref } from '../src/lib/routes';

/** Eleven URL-safe characters, exactly as YouTube uses them. */
const yt = (seed: string) => `https://www.youtube.com/watch?v=${seed}`;
const ytId = (index: number) => `${String(index).padStart(2, '0')}${'a'.repeat(9)}`;

const meta = (title: string, artist = 'Test Artist', artwork: string | null = null): TrackMeta => ({
  title,
  artist,
  artwork,
});

const seed = async (
  api: ReturnType<typeof createLocalRequestApi>,
  url: string,
  title: string,
) => {
  const result = await api.submit({ url, meta: meta(title), stationId: null });
  expect(result.ok).toBe(true);
  return result.ok ? result.request : null;
};

describe('request board — honest starting state', () => {
  it('shows nothing until somebody actually submits', async () => {
    const api = createLocalRequestApi();
    expect(await api.list()).toEqual([]);
    expect(await api.board({ tab: 'wanted' })).toEqual([]);
    expect(await api.board({ tab: 'played' })).toEqual([]);
    expect(await api.find(yt('dQw4w9WgXcQ'))).toBeNull();
    expect(await api.get('missing')).toBeNull();
  });

  it('refuses metadata without a title — no hollow cards', async () => {
    const api = createLocalRequestApi();
    const result = await api.submit({
      url: yt('dQw4w9WgXcQ'),
      meta: { title: '   ', artist: 'Someone', artwork: null },
      stationId: null,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-meta' });
    expect(await api.list()).toEqual([]);
  });

  it('clamps oversized metadata and drops unsafe artwork', async () => {
    const api = createLocalRequestApi();
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
  });

  it('notifies subscribers on every local change', async () => {
    const api = createLocalRequestApi();
    const listener = vi.fn();
    const stop = api.subscribe(listener);
    const submitted = await api.submit({
      url: yt('dQw4w9WgXcQ'),
      meta: meta('Never Gonna Give You Up'),
      stationId: null,
    });
    expect(submitted.ok).toBe(true);
    expect(listener).toHaveBeenCalled();
    if (submitted.ok) {
      await api.vote(submitted.request.id);
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    }
    stop();
  });
});

describe('request board — voting', () => {
  it('starts at zero and moves only on confirmation, once per visitor', async () => {
    let now = 1_000;
    // One store ("the server"), two visitors — uniqueness is enforced there.
    const store = createRequestStore();
    const api = createLocalRequestApi(() => now, 'visitor-a', store);
    const other = createLocalRequestApi(() => now, 'visitor-b', store);

    const request = await seed(api, yt('dQw4w9WgXcQ'), 'Never Gonna Give You Up');
    expect(request?.votes).toBe(0);
    expect(request?.mine).toBe(false);

    now = 2_000;
    const first = await api.vote(request!.id);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.request.votes).toBe(1);
      expect(first.request.mine).toBe(true);
    }

    // Double-click protection: the second attempt never inflates the count.
    now = 2_100;
    const repeat = await api.vote(request!.id);
    expect(repeat).toEqual({ ok: false, reason: 'already-voted' });
    expect((await api.get(request!.id))?.votes).toBe(1);

    // A different visitor gets exactly one more — the count is never double-applied.
    now = 2_200;
    const secondVisitor = await other.vote(request!.id);
    expect(secondVisitor.ok).toBe(true);
    if (secondVisitor.ok) {
      expect(secondVisitor.request.votes).toBe(2);
      expect(secondVisitor.request.mine).toBe(true);
    }
    expect((await api.get(request!.id))?.votes).toBe(2);
    expect(await other.vote(request!.id)).toEqual({ ok: false, reason: 'already-voted' });
    expect((await api.get(request!.id))?.votes).toBe(2);
  });

  it('rate limits runaway voting within the window', async () => {
    let now = 0;
    const api = createLocalRequestApi(() => now, 'busy-voter');
    const ids: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      now += 61_000; // outside the submit window each time
      const request = await seed(api, yt(ytId(index)), `Song ${index}`);
      ids.push(request!.id);
    }
    now += 1;
    for (let index = 0; index < 10; index += 1) {
      const result = await api.vote(ids[index]);
      expect(result.ok).toBe(true);
    }
    const overflow = await api.vote(ids[10]);
    expect(overflow).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('refuses votes on unknown or non-open requests', async () => {
    let now = 1_000;
    const api = createLocalRequestApi(() => now);
    expect(await api.vote('nope')).toEqual({ ok: false, reason: 'not-found' });

    const request = await seed(api, yt('dQw4w9WgXcQ'), 'A Song');
    now = 2_000;
    await api.markPlayed(request!.id);
    expect(await api.vote(request!.id)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('request board — ranking rules', () => {
  it('MOST WANTED sorts by votes, ties resolving to the earlier submission', async () => {
    let now = 1_000;
    const store = createRequestStore();
    const a = createLocalRequestApi(() => now, 'voter-a', store);
    const b = createLocalRequestApi(() => now, 'voter-b', store);
    const alpha = await seed(a, yt(ytId(0)), 'Alpha');
    now = 2_000;
    const beta = await seed(a, yt(ytId(1)), 'Beta');
    now = 3_000;
    const gamma = await seed(a, yt(ytId(2)), 'Gamma');

    now = 4_000;
    await a.vote(alpha!.id);
    now = 5_000;
    await a.vote(gamma!.id);
    now = 6_000;
    await b.vote(beta!.id);
    now = 7_000;
    await a.vote(beta!.id); // Beta takes the lead with two votes

    const wanted = await a.board({ tab: 'wanted' });
    expect(wanted.map((r) => r.title)).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('RISING follows recent voting activity, not totals', async () => {
    let now = 1_000;
    const api = createLocalRequestApi(() => now, 'voter');
    const a = await seed(api, yt(ytId(0)), 'Alpha');
    now = 2_000;
    const b = await seed(api, yt(ytId(1)), 'Beta');

    now = 3_000;
    await api.vote(a!.id); // Alpha voted first…
    now = 8_000;
    await api.vote(b!.id); // …Beta moved more recently → rising shows Beta first

    const rising = await api.board({ tab: 'rising' });
    expect(rising[0].title).toBe('Beta');
    expect(rising).toHaveLength(2);

    // A never-voted request has no rising activity — it stays out.
    const c = await seed(api, yt(ytId(2)), 'Gamma');
    expect(c?.lastVotedAt).toBe(0);
    expect((await api.board({ tab: 'rising' })).map((r) => r.title)).not.toContain('Gamma');
  });

  it('RECENTLY ADDED is newest-first and PLAYED is history-only', async () => {
    let now = 1_000;
    const api = createLocalRequestApi(() => now);
    const first = await seed(api, yt(ytId(0)), 'First');
    now = 2_000;
    const second = await seed(api, yt(ytId(1)), 'Second');

    const recent = await api.board({ tab: 'recent' });
    expect(recent.map((r) => r.title)).toEqual(['Second', 'First']);
    expect(await api.board({ tab: 'played' })).toEqual([]);

    now = 3_000;
    await api.markPlayed(first!.id);

    // Played requests leave every open view and land in history.
    expect((await api.board({ tab: 'recent' })).map((r) => r.title)).toEqual(['Second']);
    expect((await api.board({ tab: 'wanted' })).map((r) => r.title)).toEqual(['Second']);
    const played = await api.board({ tab: 'played' });
    expect(played.map((r) => r.title)).toEqual(['First']);
    expect(played[0].status).toBe('played');
    expect(played[0].playedAt).toBe(3_000);
    expect(second?.status).toBe('open');
  });

  it('search matches titles and artists, case-insensitively, within the tab', async () => {
    let now = 1_000;
    const api = createLocalRequestApi(() => now);
    await api.submit({
      url: yt(ytId(0)),
      meta: meta('Neon Streets', 'The Night Riders'),
      stationId: null,
    });
    now = 2_000;
    const second = await api.submit({
      url: yt(ytId(1)),
      meta: meta('Old Market', 'Baul Bhavan'),
      stationId: null,
    });

    expect(await api.board({ tab: 'wanted', query: 'nEON' })).toHaveLength(1);
    expect(await api.board({ tab: 'wanted', query: 'night riders' })).toHaveLength(1);
    expect(await api.board({ tab: 'wanted', query: 'nothing-like-this' })).toEqual([]);

    // Once played, a row disappears from open views even when searched by name.
    if (second.ok) await api.markPlayed(second.request.id);
    expect(await api.board({ tab: 'wanted', query: 'Old Market' })).toEqual([]);
    expect(await api.board({ tab: 'played', query: 'old market' })).toHaveLength(1);
  });
});

describe('deep links and sharing', () => {
  it('builds shareable /suggest-music?request= links', () => {
    expect(shareHref('abc123')).toBe('/suggest-music?request=abc123');
    expect(requestIdFromSearch('?request=abc123')).toBe('abc123');
    expect(requestIdFromSearch('?station=rain-window')).toBeNull();
    expect(requestIdFromSearch('?request=')).toBeNull();
    expect(requestIdFromSearch('?request=<script>')).toBeNull();
  });

  it('recognises both routes, with or without a trailing slash', () => {
    expect(routeFromPathname('/')).toBe('home');
    expect(routeFromPathname('/index.html')).toBe('home');
    expect(routeFromPathname('/suggest-music')).toBe('suggest');
    expect(routeFromPathname('/suggest-music/')).toBe('suggest');
  });

  it('exposes one shared app-wide board instance', () => {
    expect(getRequestApi()).toBe(getRequestApi());
  });
});

describe('provider metadata resolution', () => {
  const song = (provider: 'youtube' | 'spotify') => ({
    provider,
    id: provider === 'youtube' ? 'dQw4w9WgXcQ' : '6rqhFgbbKwnb9MLmUQDhG6',
    url:
      provider === 'youtube'
        ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        : 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
  });

  it('reads title, artist and artwork from the provider', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Never Gonna Give You Up',
        author_name: 'Rick Astley',
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      }),
    }));
    const result = await resolveTrackMeta(song('youtube'), fetcher);
    expect(result).toEqual({
      ok: true,
      meta: {
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        artwork: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('derives YouTube artwork and falls back to Unknown artist', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ title: 'A Song' }),
    }));
    const result = await resolveTrackMeta(song('youtube'), fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.artist).toBe('Unknown artist');
    expect(result.meta.artwork).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('treats a provider refusal as unavailable, a missing title included', async () => {
    const gone = await resolveTrackMeta(song('youtube'), async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    expect(gone).toEqual({ ok: false, reason: 'unavailable' });

    const hollow = await resolveTrackMeta(song('youtube'), async () => ({
      ok: true,
      status: 200,
      json: async () => ({ author_name: 'Someone' }),
    }));
    expect(hollow).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports outages as network problems, not as a broken song', async () => {
    const down = await resolveTrackMeta(song('spotify'), async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    expect(down).toEqual({ ok: false, reason: 'network' });

    const offline = await resolveTrackMeta(song('spotify'), async () => {
      throw new TypeError('fetch failed');
    });
    expect(offline).toEqual({ ok: false, reason: 'network' });
  });
});
