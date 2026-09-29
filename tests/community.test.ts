import { describe, expect, it } from 'vitest';
import { SessionTally, createLocalPresence } from '../src/lib/presence-api';
import { createLocalRatingApi } from '../src/lib/rating-api';
import { createLocalRequestApi, parseSongUrl } from '../src/lib/request-api';

describe('presence SessionTally', () => {
  it('counts touched sessions and forgets removed ones', () => {
    const tally = new SessionTally(() => 1000);
    tally.touch('a');
    tally.touch('b');
    expect(tally.has('a')).toBe(true);
    expect(tally.size).toBe(2);
    tally.remove('a');
    expect(tally.size).toBe(1);
  });

  it('expires sessions that missed their heartbeats', () => {
    let now = 0;
    const tally = new SessionTally(() => now);
    tally.touch('fresh');
    now = 10_000;
    tally.touch('stale');
    now = 20_000;
    expect(tally.prune(15_000)).toBe(true); // 'fresh' dropped, count changed
    expect(tally.size).toBe(1);
    expect(tally.has('stale')).toBe(true);
    now = 40_000;
    expect(tally.prune(15_000)).toBe(true);
    expect(tally.size).toBe(0);
  });

  it('reports no change when pruning changes nothing', () => {
    let now = 0;
    const tally = new SessionTally(() => now);
    tally.touch('a');
    now = 1_000;
    expect(tally.prune(15_000)).toBe(false);
  });
});

describe('local presence channel', () => {
  it('always counts at least this session without waiting on a backend', () => {
    const presence = createLocalPresence();
    const seen: number[] = [];
    const stop = presence.subscribe((count) => seen.push(count));
    expect(seen[0]).toBeGreaterThanOrEqual(1);
    stop();
    presence.close();
  });
});

describe('song link parsing', () => {
  it('accepts YouTube videos in every common shape', () => {
    const id = 'dQw4w9WgXcQ';
    const shapes = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://m.youtube.com/watch?v=${id}&si=abc123`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `http://youtube.com/watch?v=${id}`,
    ];
    for (const url of shapes) {
      const song = parseSongUrl(url);
      expect(song, url).not.toBeNull();
      expect(song?.provider).toBe('youtube');
      expect(song?.id).toBe(id);
      // Identity is the ID — share params never survive normalisation.
      expect(song?.url).toBe(`https://www.youtube.com/watch?v=${id}`);
    }
  });

  it('accepts Spotify tracks, including embed and intl forms', () => {
    const id = '6rqhFgbbKwnb9MLmUQDhG6';
    const shapes = [
      `https://open.spotify.com/track/${id}`,
      `https://open.spotify.com/track/${id}?si=xyz`,
      `https://open.spotify.com/embed/track/${id}`,
      `https://open.spotify.com/intl-de/track/${id}`,
    ];
    for (const url of shapes) {
      const song = parseSongUrl(url);
      expect(song, url).not.toBeNull();
      expect(song?.provider).toBe('spotify');
      expect(song?.id).toBe(id);
      expect(song?.url).toBe(`https://open.spotify.com/track/${id}`);
    }
  });

  it('rejects surfaces that are not a single song', () => {
    const rejected = [
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/watch?v=short',
      'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF',
      'https://soundcloud.com/some/track',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)',
      'not a url at all',
      '',
    ];
    for (const url of rejected) {
      expect(parseSongUrl(url), url).toBeNull();
    }
  });
});

describe('suggestion queue', () => {
  const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const spotifyUrl = 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6';
  const meta = (title: string, artist = 'Test Artist') => ({ title, artist, artwork: null });

  it('submits, deduplicates by identity and lists newest first', async () => {
    let now = 1_000;
    const api = createLocalRequestApi(() => now);

    const first = await api.submit({
      url: youtubeUrl,
      meta: meta('Never Gonna Give You Up'),
      stationId: 'rain-window',
    });
    expect(first.ok).toBe(true);

    // Same video, different share params — still the same song.
    now = 2_000;
    const duplicate = await api.submit({
      url: `${youtubeUrl}&si=zzz`,
      meta: meta('Never Gonna Give You Up'),
      stationId: 'rain-window',
    });
    expect(duplicate).toEqual({ ok: false, reason: 'duplicate' });

    now = 3_000;
    const second = await api.submit({
      url: spotifyUrl,
      meta: meta('Spotify Song'),
      stationId: null,
    });
    expect(second.ok).toBe(true);

    const list = await api.list();
    expect(list).toHaveLength(2);
    expect(list[0].song.provider).toBe('spotify');
    expect(list[1].song.provider).toBe('youtube');
  });

  it('refuses garbage links as invalid-url', async () => {
    const api = createLocalRequestApi();
    const result = await api.submit({
      url: 'https://example.com/anything',
      meta: meta('Anything'),
      stationId: null,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-url' });
  });

  it('rate limits bursts, then lets the window slide', async () => {
    let now = 0;
    const api = createLocalRequestApi(() => now);
    for (let index = 0; index < 3; index += 1) {
      now = index * 1_000;
      const result = await api.submit({
        url: `https://www.youtube.com/watch?v=aaaaaaaaa${index}0`,
        meta: meta(`Song ${index}`),
        stationId: null,
      });
      expect(result.ok).toBe(true);
    }
    now = 4_000;
    const burst = await api.submit({
      url: 'https://www.youtube.com/watch?v=bbbbbbbbb10',
      meta: meta('Burst'),
      stationId: null,
    });
    expect(burst).toEqual({ ok: false, reason: 'rate-limited' });

    // A minute later the window has moved on.
    now = 61_000;
    const later = await api.submit({
      url: 'https://www.youtube.com/watch?v=ccccccccc10',
      meta: meta('Later'),
      stationId: null,
    });
    expect(later.ok).toBe(true);
  });
});

describe('station ratings', () => {
  it('starts honest: zero ratings until somebody rates', async () => {
    const api = createLocalRatingApi();
    const summary = await api.get('rain-window');
    expect(summary).toEqual({
      stationId: 'rain-window',
      count: 0,
      average: null,
      mine: null,
    });
  });

  it('aggregates and reports this visitor’s own rating', async () => {
    const api = createLocalRatingApi();
    const after = await api.rate('rain-window', 4);
    expect(after.count).toBe(1);
    expect(after.average).toBe(4);
    expect(after.mine).toBe(4);
    expect(await api.get('rain-window')).toEqual(after);
  });

  it('updates the same visitor’s row instead of inflating the count', async () => {
    const api = createLocalRatingApi('visitor-a');
    await api.rate('rain-window', 3);
    const changed = await api.rate('rain-window', 5);
    expect(changed.count).toBe(1);
    expect(changed.average).toBe(5);
    expect(changed.mine).toBe(5);
  });

  it('rejects ratings outside 1–5', async () => {
    const api = createLocalRatingApi();
    await expect(api.rate('rain-window', 0)).rejects.toThrow();
    await expect(api.rate('rain-window', 6)).rejects.toThrow();
    await expect(api.rate('rain-window', 3.2)).resolves.toMatchObject({ average: 3 });
  });
});
