import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { STATIONS } from '../src/data/stations';
import type { SongRequest } from '../src/lib/request-api';
import { resetBackdropPicks, sessionBackdrop } from '../src/lib/backdrop';
import {
  fallsBackToStations,
  isQueueEligible,
  pickNextRequest,
  radioIsSilent,
  requestStationId,
  retireReason,
} from '../src/lib/queue';
import { embedSourceForRequest } from '../src/lib/sourcePolicy';
import type { Station } from '../src/types/station';

const YT_ID = 'abcdefghijk'; // 11 chars — YouTube's video id shape
const SP_ID = '0123456789abcdefghij01'; // 22 chars — Spotify's track id shape

const request = (overrides: Partial<SongRequest> & { id: string }): SongRequest => ({
  song: { provider: 'youtube', id: YT_ID, url: `https://www.youtube.com/watch?v=${YT_ID}` },
  title: 'Song',
  artist: 'Artist',
  artwork: null,
  status: 'open',
  votes: 0,
  likes: 0,
  createdAt: 1,
  lastVotedAt: 0,
  playedAt: null,
  stationId: null,
  mine: false,
  liked: false,
  ...overrides,
});

describe('request embeds (community queue → official player)', () => {
  it('builds a single-video embed for a valid YouTube request', () => {
    const source = embedSourceForRequest(request({ id: 'r1' }));
    expect(source).toEqual({
      provider: 'youtube',
      playlistId: YT_ID,
      entity: 'video',
      url: `https://www.youtube.com/watch?v=${YT_ID}`,
    });
  });

  it('builds a single-track embed for a valid Spotify request', () => {
    const source = embedSourceForRequest(
      request({
        id: 'r2',
        song: { provider: 'spotify', id: SP_ID, url: `https://open.spotify.com/track/${SP_ID}` },
      }),
    );
    expect(source).toEqual({
      provider: 'spotify',
      playlistId: SP_ID,
      entity: 'track',
      url: `https://open.spotify.com/track/${SP_ID}`,
    });
  });

  it('refuses malformed ids and unsafe URLs — nothing reaches an engine', () => {
    expect(
      embedSourceForRequest(
        request({ id: 'r3', song: { provider: 'youtube', id: 'short', url: 'https://www.youtube.com/watch?v=short' } }),
      ),
    ).toBeNull();
    expect(
      embedSourceForRequest(
        request({ id: 'r4', song: { provider: 'youtube', id: YT_ID, url: 'javascript:alert(1)' } }),
      ),
    ).toBeNull();
    expect(
      embedSourceForRequest(
        request({
          id: 'r5',
          song: { provider: 'spotify', id: SP_ID, url: 'data:text/html,x' },
        }),
      ),
    ).toBeNull();
  });
});

describe('queue eligibility', () => {
  const skip = new Set<string>();

  it('picks the first eligible request in board order (votes first)', () => {
    const items = [request({ id: 'a', votes: 5 }), request({ id: 'b', votes: 2 })];
    expect(pickNextRequest(items, skip, null)?.id).toBe('a');
  });

  it('never re-airs the request currently on air', () => {
    const items = [request({ id: 'a' }), request({ id: 'b' })];
    expect(pickNextRequest(items, skip, 'a')?.id).toBe('b');
  });

  it('skips requests whose source failed this session', () => {
    const items = [request({ id: 'a' }), request({ id: 'b' })];
    expect(pickNextRequest(items, new Set(['a']), null)?.id).toBe('b');
  });

  it('skips requests that are not open (played or unavailable)', () => {
    const items = [
      request({ id: 'a', status: 'played' }),
      request({ id: 'b', status: 'unavailable' }),
      request({ id: 'c' }),
    ];
    expect(pickNextRequest(items, skip, null)?.id).toBe('c');
  });

  it('skips requests whose song cannot be embedded', () => {
    const items = [
      request({ id: 'a', song: { provider: 'youtube', id: 'bad', url: 'https://www.youtube.com/watch?v=bad' } }),
      request({ id: 'b' }),
    ];
    expect(pickNextRequest(items, skip, null)?.id).toBe('b');
    expect(isQueueEligible(items[0], skip, null)).toBe(false);
  });

  it('returns null on an empty board — stations take over', () => {
    expect(pickNextRequest([], skip, null)).toBeNull();
  });
});

describe('hand-off rules', () => {
  it('retires a request to history only after it aired (clean end or Next)', () => {
    expect(retireReason('request')).toBe('played');
    expect(retireReason('manual')).toBe('played');
    expect(retireReason('audio')).toBeNull();
    expect(retireReason('station-embed')).toBeNull();
    expect(retireReason('error')).toBeNull();
  });

  it('station rotation resumes everywhere except inside a provider playlist', () => {
    expect(fallsBackToStations('audio')).toBe(true);
    expect(fallsBackToStations('request')).toBe(true);
    expect(fallsBackToStations('manual')).toBe(true);
    expect(fallsBackToStations('error')).toBe(true);
    expect(fallsBackToStations('station-embed')).toBe(false);
  });

  it('addresses requests through a synthetic station id', () => {
    expect(requestStationId('abc')).toBe('request:abc');
  });
});

describe('immediate air (submit / vote on a silent radio)', () => {
  it('airs right away only when the radio has never started this session', () => {
    expect(radioIsSilent('idle', false)).toBe(true);
  });

  it('never interrupts: paused, loading, playing or error stay respected', () => {
    expect(radioIsSilent('paused', false)).toBe(false);
    expect(radioIsSilent('loading', false)).toBe(false);
    expect(radioIsSilent('playing', false)).toBe(false);
    expect(radioIsSilent('error', false)).toBe(false);
  });

  it('yields whenever another request is already on air', () => {
    expect(radioIsSilent('idle', true)).toBe(false);
  });
});

describe('session backdrop (one draw per page load)', () => {
  beforeEach(() => resetBackdropPicks());

  const stage = (id: string, backdrops?: string[]): Station => ({
    id,
    name: 'Stage',
    category: 'mix',
    description: 'Stage',
    artwork: '/art/stage.svg',
    url: 'https://example.org/stage',
    action: 'play',
    sourceType: 'direct-audio',
    backdrops,
  });

  it('returns null when the station offers no alternatives', () => {
    expect(sessionBackdrop(stage('plain'))).toBeNull();
    expect(sessionBackdrop(null)).toBeNull();
    expect(sessionBackdrop(stage('empty', []))).toBeNull();
  });

  it('draws from the pool with the injected random and keeps that draw', () => {
    const station = stage('hero', ['one.jpg', 'two.jpg', 'three.jpg']);
    expect(sessionBackdrop(station, () => 0.4)).toBe('two.jpg');
    // Same load, different random — the first draw sticks until reload.
    expect(sessionBackdrop(station, () => 0.9)).toBe('two.jpg');
  });

  it('clamps out-of-range draws instead of producing undefined', () => {
    const station = stage('clamp', ['one.jpg', 'two.jpg']);
    expect(sessionBackdrop(stage('top', ['one.jpg', 'two.jpg']), () => 0.99)).toBe('two.jpg');
    expect(sessionBackdrop(station, () => 1)).toBe('two.jpg');
    expect(sessionBackdrop(stage('zero', ['one.jpg', 'two.jpg']), () => -1)).toBe('one.jpg');
  });

  it('a reload-equivalent reset draws again', () => {
    const station = stage('again', ['one.jpg', 'two.jpg']);
    const first = sessionBackdrop(station, () => 0.1);
    resetBackdropPicks();
    const second = sessionBackdrop(station, () => 0.1);
    expect(second).toBe(first);
    resetBackdropPicks();
    expect(sessionBackdrop(station, () => 0.9)).toBe('two.jpg');
  });
});

describe('nostalgia-radio backdrop inventory', () => {
  const station = STATIONS.find((item) => item.id === 'nostalgia-radio');

  it('ships the seven supplied stage photos, self-hosted in /public', () => {
    expect(station?.backdrops).toHaveLength(7);
    (station?.backdrops ?? []).forEach((url, index) => {
      expect(url).toBe(`/img/backdrops/stage-${index + 1}.jpg`);
      const file = fileURLToPath(new URL(`../public${url}`, import.meta.url));
      expect(existsSync(file)).toBe(true);
    });
  });

  it('keeps the fixed artwork as identity alongside the stage photos', () => {
    expect(station?.artwork).toBe('/art/neighborhood.svg');
  });
});
