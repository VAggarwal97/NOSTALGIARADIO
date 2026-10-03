import { describe, expect, it } from 'vitest';

import {
  broadcastElapsedSec,
  broadcastPastEnd,
  clockFor,
  decisionForBroadcastTrack,
  embedDecisionForUrl,
  isBroadcastTrack,
  isBroadcastUpcomingItem,
  reportableDuration,
  trackSignature,
} from '../src/lib/broadcast';
import type { BroadcastSnapshot, BroadcastTrack } from '../src/lib/broadcast';

/**
 * The shared broadcast clock is the spine of the whole live player: every
 * listener, new or old, must derive the same position from the same facts.
 * These tests pin that arithmetic, the row validation that keeps garbage out
 * of the engine, and the honest source mapping (null = skip, never fake).
 */

const TRACK: BroadcastTrack = {
  category_slug: 'mix',
  track_kind: 'song',
  track_key: 'nostalgia-radio:Demo Tape A',
  station_slug: 'nostalgia-radio',
  title: 'Demo Tape A',
  subtitle: 'Nostalgia Radio',
  artwork_url: '/img/demo-a.jpg',
  source_type: 'direct-audio',
  source_url: '/audio/demo-a.wav',
  duration_sec: 12,
  started_at: '2026-10-02T12:00:00+00:00',
  status: 'live',
};

const snapshot = (over: Partial<BroadcastSnapshot> = {}): BroadcastSnapshot => ({
  broadcast: TRACK,
  server_now: '2026-10-02T12:00:05+00:00',
  upcoming: [],
  ...over,
});

describe('clock pairing', () => {
  it('couples the server reading with the local reading taken on arrival', () => {
    const local = Date.parse('2026-10-02T15:00:10+02:00');
    const clock = clockFor(snapshot(), local);
    expect(clock.serverNowMs).toBe(Date.parse('2026-10-02T12:00:05+00:00'));
    expect(clock.fetchedAtMs).toBe(local);
  });

  it('degrades to the local clock when the server sends nonsense', () => {
    const local = 1_700_000_000_000;
    const clock = clockFor(snapshot({ server_now: 'not-a-date' }), local);
    expect(clock.serverNowMs).toBe(local);
  });
});

describe('broadcastElapsedSec', () => {
  it('reads 5s from the fetch-time remainder alone', () => {
    const clock = clockFor(snapshot());
    // now == fetchedAt → local drift is zero → pure (server_now - started_at)
    expect(broadcastElapsedSec(TRACK, clock, clock.fetchedAtMs)).toBe(5);
  });

  it('carries local time forward — a listener of 7s sees 12s', () => {
    const clock = clockFor(snapshot());
    expect(broadcastElapsedSec(TRACK, clock, clock.fetchedAtMs + 7_000)).toBe(12);
  });

  it('cancels client/server skew: only the difference moves', () => {
    // Server clock an hour ahead of the client — the pairing normalises it.
    const skew = snapshot({ server_now: '2026-10-02T13:00:05+00:00' });
    const clock = clockFor(skew, Date.parse('2026-10-02T14:00:05+00:00'));
    expect(broadcastElapsedSec(TRACK, clock, clock.fetchedAtMs)).toBe(3605);
  });

  it('never reports a negative position (a row from the future)', () => {
    const future: BroadcastTrack = { ...TRACK, started_at: '2026-10-02T12:01:00+00:00' };
    const clock = clockFor(snapshot({ broadcast: future }));
    expect(broadcastElapsedSec(future, clock, clock.fetchedAtMs)).toBe(0);
  });
});

describe('broadcastPastEnd (the advance tick guard)', () => {
  it('stays false one tick before the end and true at it', () => {
    const clock = clockFor(snapshot());
    // Fetch already reads 5s in → the 12s boundary lands 7s after the fetch.
    expect(broadcastPastEnd(TRACK, clock, clock.fetchedAtMs + 6_000)).toBe(false);
    expect(broadcastPastEnd(TRACK, clock, clock.fetchedAtMs + 7_000)).toBe(true);
    expect(broadcastPastEnd(TRACK, clock, clock.fetchedAtMs + 8_000)).toBe(true);
  });

  it('never ends a track whose length is unknown — the engine decides', () => {
    const unknown: BroadcastTrack = { ...TRACK, duration_sec: null };
    const clock = clockFor(snapshot({ broadcast: unknown }));
    expect(broadcastPastEnd(unknown, clock, clock.fetchedAtMs + 86_400_000)).toBe(false);
  });
});

describe('trackSignature', () => {
  it('separates kinds so the same key never collides across tables', () => {
    const asSuggestion: BroadcastTrack = { ...TRACK, track_kind: 'suggestion' };
    expect(trackSignature(TRACK)).not.toBe(trackSignature(asSuggestion));
    expect(trackSignature(TRACK)).toBe('song:nostalgia-radio:Demo Tape A');
  });
});

describe('row validation (isBroadcastTrack / isBroadcastUpcomingItem)', () => {
  it('accepts a well-formed row', () => {
    expect(isBroadcastTrack(TRACK)).toBe(true);
    expect(isBroadcastUpcomingItem({ kind: 'suggestion', key: 'k', title: 'T' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['string', 'broadcast'],
    ['missing started_at', { ...TRACK, started_at: undefined }],
    ['unparseable started_at', { ...TRACK, started_at: 'tomorrowish' }],
    ['unknown source_type', { ...TRACK, source_type: 'bitrate-farm' }],
    ['unknown track_kind', { ...TRACK, track_kind: 'podcast' }],
    ['bad status', { ...TRACK, status: 'reeling' }],
    ['zero duration', { ...TRACK, duration_sec: 0 }],
    ['string duration', { ...TRACK, duration_sec: '12' }],
    ['non-numeric source_url', { ...TRACK, source_url: 42 }],
  ])('rejects %s', (_label, value) => {
    expect(isBroadcastTrack(value)).toBe(false);
  });

  it('rejects upcoming entries without a kind or title', () => {
    expect(isBroadcastUpcomingItem({ key: 'k', title: 'T' })).toBe(false);
    expect(isBroadcastUpcomingItem({ kind: 'song', key: 'k' })).toBe(false);
    expect(isBroadcastUpcomingItem([1, 2, 3])).toBe(false);
  });
});

describe('decisionForBroadcastTrack', () => {
  it('maps a local file to a play decision', () => {
    expect(decisionForBroadcastTrack(TRACK)).toEqual({
      kind: 'play',
      audioUrl: '/audio/demo-a.wav',
    });
  });

  it('refuses (null) rather than guessing when the pointer is missing', () => {
    expect(decisionForBroadcastTrack({ ...TRACK, source_url: null })).toBeNull();
  });

  it('refuses non-http(s) schemes; trusts admin-authored https pointers', () => {
    expect(
      decisionForBroadcastTrack({ ...TRACK, source_url: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(
      decisionForBroadcastTrack({ ...TRACK, source_url: 'ftp://files.test/x.mp3' }),
    ).toBeNull();
    // Audio legitimately lives anywhere (CDN, host, archive) — the pointer is
    // authored through the admin catalogue, so https is the whole policy.
    expect(
      decisionForBroadcastTrack({ ...TRACK, source_url: 'https://cdn.example.org/x.mp3' }),
    ).toEqual({ kind: 'play', audioUrl: 'https://cdn.example.org/x.mp3' });
  });

  it('maps the flagship playlist to an official youtube embed', () => {
    const decision = decisionForBroadcastTrack({
      ...TRACK,
      source_type: 'youtube',
      source_url: 'https://www.youtube.com/playlist?list=PLjxsdvPZH24OZoxZSnuEqrW1crVtceCNG',
    });
    expect(decision).toEqual({
      kind: 'embed',
      source: {
        provider: 'youtube',
        playlistId: 'PLjxsdvPZH24OZoxZSnuEqrW1crVtceCNG',
        entity: 'playlist',
        url: 'https://www.youtube.com/playlist?list=PLjxsdvPZH24OZoxZSnuEqrW1crVtceCNG',
      },
    });
  });

  it('refuses an embed whose URL points outside the provider', () => {
    expect(
      decisionForBroadcastTrack({
        ...TRACK,
        source_type: 'youtube',
        source_url: 'https://notyoutube.example/watch?v=abcdefghijk',
      }),
    ).toBeNull();
  });
});

describe('embedDecisionForUrl', () => {
  const yt = 'https://www.youtube.com/watch?v=abcdefghijk';
  const sp = 'https://open.spotify.com/track/0123456789abcdefghij01';

  it('parses youtube video, shorts and playlist forms', () => {
    expect(embedDecisionForUrl('youtube', yt)?.source.entity).toBe('video');
    expect(
      embedDecisionForUrl('youtube', 'https://www.youtube.com/shorts/abcdefghijk')?.source
        .entity,
    ).toBe('video');
    expect(
      embedDecisionForUrl('youtube', 'https://music.youtube.com/playlist?list=PL123456789')?.source
        .entity,
    ).toBe('playlist');
  });

  it('parses spotify track and playlist forms', () => {
    expect(embedDecisionForUrl('spotify', sp)?.source.entity).toBe('track');
    expect(
      embedDecisionForUrl('spotify', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.source
        .entity,
    ).toBe('playlist');
  });

  it('rejects ids of the wrong shape and foreign hosts', () => {
    expect(embedDecisionForUrl('youtube', 'https://www.youtube.com/watch?v=short')).toBeNull();
    expect(embedDecisionForUrl('youtube', 'https://evil.test/watch?v=abcdefghijk')).toBeNull();
    expect(embedDecisionForUrl('spotify', 'https://open.spotify.com/album/0123456789abcdefghij01')).toBeNull();
    expect(embedDecisionForUrl('youtube', 'not a url')).toBeNull();
  });
});

describe('reportableDuration', () => {
  it('passes through what the server accepts (10–900s), rounded', () => {
    expect(reportableDuration(253.4)).toBe(253);
    expect(reportableDuration(10)).toBe(10);
    expect(reportableDuration(900)).toBe(900);
  });

  it.each([
    ['too short', 9.4],
    ['too long', 901],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('reports nothing for %s', (_label, value) => {
    expect(reportableDuration(value)).toBeNull();
  });
});
