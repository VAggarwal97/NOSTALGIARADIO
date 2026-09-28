import { describe, expect, it } from 'vitest';
import { audioUrlFor, decideSource, labelForDecision, primaryAction } from '../src/lib/sourcePolicy';
import type { Station } from '../src/types/station';

const base: Station = {
  id: 'sample',
  name: 'Sample',
  category: 'ambient',
  description: 'A sample station.',
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

  it('never plays an unavailable station', () => {
    const station: Station = { ...playable, availability: 'unavailable' };
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
    expect(decideSource({ ...base, availability: 'unavailable' }).kind).toBe('check');
    expect(decideSource({ ...base, availability: 'unknown' }).kind).toBe('check');
    expect(decideSource(base).kind).toBe('open');
  });

  it('blocks unsafe source URLs', () => {
    expect(decideSource({ ...base, url: 'javascript:alert(1)' }).kind).toBe('blocked');
  });

  it('labels each decision for the UI', () => {
    expect(labelForDecision(decideSource(playable))).toBe('Play');
    expect(labelForDecision(decideSource(base))).toBe('Enter Station');
    expect(labelForDecision(decideSource({ ...base, availability: 'unavailable' }))).toBe(
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
