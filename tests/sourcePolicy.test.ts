import { describe, expect, it } from 'vitest';
import {
  audioUrlFor,
  decideSource,
  embedSourceFor,
  isPlayableDecision,
  labelForDecision,
  primaryAction,
} from '../src/lib/sourcePolicy';
import type { Station } from '../src/types/station';

const base: Station = {
  id: 'sample',
  name: 'Sample',
  category: 'ambient',
  description: 'A sample station.',
  artwork: '/art/cafe.svg',
  url: 'https://example.org/sample',
  action: 'check',
  sourceType: 'external-site',
};

const playable: Station = {
  ...base,
  id: 'playable',
  name: 'Playable',
  action: 'play',
  sourceType: 'direct-audio',
  audioUrl: '/audio/demo-a.wav',
};

describe('decideSource', () => {
  it('allows a validated direct-audio source to play', () => {
    expect(decideSource(playable)).toEqual({ kind: 'play', audioUrl: '/audio/demo-a.wav' });
    expect(audioUrlFor(playable)).toBe('/audio/demo-a.wav');
  });

  it('never plays an offline station', () => {
    const station: Station = { ...playable, status: 'offline' };
    expect(decideSource(station).kind).toBe('check');
    expect(audioUrlFor(station)).toBeNull();
  });

  it('treats an unverified station as a check, not a play', () => {
    const station: Station = { ...playable, status: 'unknown' };
    expect(decideSource(station).kind).toBe('check');
    expect(audioUrlFor(station)).toBeNull();
  });

  it('rejects unsafe audio URLs instead of playing them', () => {
    const station: Station = { ...playable, audioUrl: 'javascript:alert(1)' };
    const decision = decideSource(station);
    expect(decision.kind).toBe('blocked');
    expect(audioUrlFor(station)).toBeNull();
  });

  it('falls back to opening the page when audio is missing', () => {
    const { audioUrl: _audioUrl, ...withoutAudio } = playable;
    expect(decideSource(withoutAudio as Station).kind).toBe('open');
  });

  it('routes check-only stations to their source page', () => {
    expect(decideSource({ ...base, status: 'offline' }).kind).toBe('check');
    expect(decideSource({ ...base, status: 'unknown' }).kind).toBe('check');
    expect(decideSource(base).kind).toBe('open');
  });

  it('blocks unsafe source URLs', () => {
    expect(decideSource({ ...base, url: 'javascript:alert(1)' }).kind).toBe('blocked');
  });

  it('labels each decision for the UI', () => {
    expect(labelForDecision(decideSource(playable))).toBe('Play');
    expect(labelForDecision(decideSource(base))).toBe('Enter Station');
    expect(labelForDecision(decideSource({ ...base, status: 'offline' }))).toBe(
      'Check Station',
    );
    expect(labelForDecision(decideSource({ ...base, url: 'javascript:alert(1)' }))).toBe(
      'Unavailable',
    );
  });

  it('exposes the primary action verb', () => {
    expect(primaryAction(playable)).toBe('play');
    expect(primaryAction(base)).toBe('open');
  });
});

describe('provider embeds', () => {
  const youtube: Station = {
    ...base,
    id: 'yt',
    name: 'YT',
    provider: 'youtube',
    playlistUrl: 'https://www.youtube.com/playlist?list=PLrAXmiErZklHj5gv-9p2Zb-abc123DEF456',
  };

  const spotify: Station = {
    ...base,
    id: 'sp',
    name: 'SP',
    provider: 'spotify',
    playlistUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXksteqSVTH61',
  };

  it('extracts the playlist ID from a YouTube playlist page', () => {
    const source = embedSourceFor(youtube);
    expect(source).toEqual({
      provider: 'youtube',
      playlistId: 'PLrAXmiErZklHj5gv-9p2Zb-abc123DEF456',
      url: youtube.playlistUrl,
    });
  });

  it('accepts YouTube Music playlist URLs', () => {
    const station: Station = {
      ...youtube,
      playlistUrl: 'https://music.youtube.com/playlist?list=PLabcDEF123ghi456JKL789',
    };
    expect(embedSourceFor(station)?.playlistId).toBe('PLabcDEF123ghi456JKL789');
  });

  it('extracts the playlist ID from a Spotify playlist URL', () => {
    expect(embedSourceFor(spotify)?.playlistId).toBe('37i9dQZF1DXksteqSVTH61');
  });

  it('rejects non-playlist URLs even on the right host', () => {
    expect(embedSourceFor({ ...youtube, playlistUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123def456' })).toBeNull();
    expect(embedSourceFor({ ...youtube, playlistUrl: 'https://youtu.be/dQw4w9WgXcQ' })).toBeNull();
    expect(embedSourceFor({ ...spotify, playlistUrl: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' })).toBeNull();
    expect(embedSourceFor({ ...spotify, playlistUrl: 'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX' })).toBeNull();
  });

  it('rejects wrong hosts, unsafe URLs and provider mismatches', () => {
    expect(embedSourceFor({ ...youtube, playlistUrl: 'https://evil.example/playlist?list=PLabc123def456' })).toBeNull();
    expect(embedSourceFor({ ...youtube, playlistUrl: 'javascript:alert(1)' })).toBeNull();
    expect(embedSourceFor({ ...youtube, provider: 'spotify' })).toBeNull();
    expect(embedSourceFor({ ...spotify, provider: 'youtube' })).toBeNull();
  });

  it('treats placeholder playlist IDs as unconfigured, not playable', () => {
    expect(
      embedSourceFor({ ...youtube, playlistUrl: 'https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID' }),
    ).toBeNull();
    expect(
      embedSourceFor({ ...spotify, playlistUrl: 'https://open.spotify.com/playlist/YOUR_PLAYLIST_ID' }),
    ).toBeNull();
  });

  it('ignores a playlist URL without a provider and vice versa', () => {
    const { provider: _provider, ...urlOnly } = youtube;
    expect(embedSourceFor(urlOnly as Station)).toBeNull();
    const { playlistUrl: _url, ...providerOnly } = youtube;
    expect(embedSourceFor(providerOnly as Station)).toBeNull();
  });

  it('decides to play a configured provider station through its embed', () => {
    const decision = decideSource(youtube);
    expect(decision.kind).toBe('embed');
    expect(isPlayableDecision(decision)).toBe(true);
    expect(labelForDecision(decision)).toBe('Play');
    expect(primaryAction(youtube)).toBe('play');
    expect(audioUrlFor(youtube)).toBeNull();
  });

  it('never promotes an unverified station to an embed', () => {
    expect(decideSource({ ...youtube, status: 'offline' }).kind).toBe('check');
    expect(decideSource({ ...youtube, status: 'unknown' }).kind).toBe('check');
  });

  it('prefers the configured provider over local demo audio', () => {
    const both: Station = { ...playable, provider: 'youtube', playlistUrl: youtube.playlistUrl };
    expect(decideSource(both).kind).toBe('embed');
  });

  it('keeps check-only stations on their source page until a playlist is configured', () => {
    expect(decideSource(base).kind).toBe('open');
    expect(embedSourceFor(base)).toBeNull();
  });
});
