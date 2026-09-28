import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  categoryLabel,
  findStation,
  neighbours,
  randomStation,
  searchStations,
  stationsForCategory,
} from '../src/lib/catalog';
import { STATIONS } from '../src/data/stations';
import { CATEGORIES } from '../src/data/categories';
import { isSafeUrl } from '../src/lib/urlSafety';

describe('catalog integrity', () => {
  it('has unique IDs across the whole inventory', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses known home categories', () => {
    const known = new Set(CATEGORIES.filter((c) => c.id !== 'mix').map((c) => c.id));
    for (const station of STATIONS) expect(known.has(station.category), station.id).toBe(true);
  });

  it('mix returns only featured stations', () => {
    const mix = stationsForCategory('mix');
    expect(mix.length).toBeGreaterThan(0);
    expect(mix.every((s) => s.featured)).toBe(true);
  });

  it('every category with stations returns them', () => {
    for (const category of CATEGORIES.filter((c) => c.id !== 'mix')) {
      const id = category.id as Exclude<typeof category.id, 'mix'>;
      const list = stationsForCategory(id);
      expect(list.length, id).toBeGreaterThan(0);
      for (const station of list) {
        const member = station.category === id || (station.secondaryCategories?.includes(id) ?? false);
        expect(member, `${station.id} in ${id}`).toBe(true);
      }
    }
  });

  it('finds stations by id and handles misses', () => {
    expect(findStation('musafir')?.name).toBe('Musafir');
    expect(findStation('does-not-exist')).toBeUndefined();
    expect(findStation(null)).toBeUndefined();
  });

  it('resolves labels', () => {
    expect(categoryLabel('festival')).toBe('Festivals');
    expect(categoryLabel('transit')).toBe('Travel');
    expect(categoryLabel('unknown' as never)).toBe('unknown');
  });
});

describe('neighbours', () => {
  const pool = stationsForCategory('transit');

  it('wraps around the rail', () => {
    const { previous, next } = neighbours(pool[0], pool);
    expect(previous?.id).toBe(pool[pool.length - 1].id);
    expect(next?.id).toBe(pool[1].id);
  });

  it('handles a station outside the current pool', () => {
    const stranger = findStation('kassita')!;
    expect(pool.some((s) => s.id === stranger.id)).toBe(false);
    const { previous, next } = neighbours(stranger, pool);
    expect(previous?.id).toBe(pool[pool.length - 1].id);
    expect(next?.id).toBe(pool[0].id);
  });

  it('handles empty input', () => {
    expect(neighbours(null, [])).toEqual({ previous: null, next: null });
  });
});

describe('search', () => {
  it('matches on name, region, language, tags and category', () => {
    expect(searchStations('musafir')[0]?.id).toBe('musafir');
    expect(searchStations('bihar').length).toBeGreaterThan(0);
    expect(searchStations('marwari').length).toBeGreaterThan(0);
    expect(searchStations('chai').length).toBeGreaterThan(0);
    expect(searchStations('festival').length).toBeGreaterThan(0);
  });

  it('is case and whitespace insensitive', () => {
    expect(searchStations('  MUSAFIR ')[0]?.id).toBe('musafir');
  });

  it('returns nothing for an empty query', () => {
    expect(searchStations('')).toEqual([]);
    expect(searchStations('   ')).toEqual([]);
  });

  it('ranks exact-name matches first', () => {
    expect(searchStations('tapri')[0]?.id).toBe('tapri-talk');
  });

  it('suggests nothing impossible', () => {
    expect(searchStations('zzzzz-nothing')).toEqual([]);
  });
});

describe('randomStation', () => {  it('picks a playable station different from the current one when possible', () => {
    for (let i = 0; i < 25; i += 1) {
      const station = randomStation('musafir');
      expect(station.id).not.toBe('musafir');
      expect(station.action).toBe('play');
    }
  });

  it('stays within the inventory', () => {
    const ids = new Set(STATIONS.map((s) => s.id));
    for (let i = 0; i < 25; i += 1) expect(ids.has(randomStation().id)).toBe(true);
  });
});

describe('cinematic spec invariants', () => {
  it('matches the required category labels', () => {
    expect(CATEGORIES.map((c) => c.shortLabel)).toEqual([
      'Mix',
      'Travel',
      'Beyond',
      'Folk',
      'Ambient',
      'Festivals',
      'Work',
      'Shop',
    ]);
  });

  it('every station ships local artwork that exists on disk', () => {
    for (const station of STATIONS) {
      expect(station.artwork, station.id).toMatch(/^\/art\/[a-z0-9-]+\.svg$/);
      const file = path.join(process.cwd(), 'public', station.artwork.replace(/^\//, ''));
      expect(fs.existsSync(file), `${station.id} → ${station.artwork}`).toBe(true);
    }
  });

  it('never stores invented popularity or playback metrics', () => {
    for (const station of STATIONS) {
      expect('rating' in station, station.id).toBe(false);
      expect('ratingCount' in station, station.id).toBe(false);
      expect('heat' in station, station.id).toBe(false);
      expect('listeners' in station, station.id).toBe(false);
      expect('progress' in station, station.id).toBe(false);
    }
  });

  it('only keeps validated http(s) external links', () => {
    for (const station of STATIONS) {
      for (const link of station.externalLinks ?? []) {
        expect(link.label.length, station.id).toBeGreaterThan(0);
        expect(isSafeUrl(link.url), `${station.id} → ${link.url}`).toBe(true);
      }
    }
  });

  it('marks a set of featured stations for the hero picks', () => {
    expect(STATIONS.filter((s) => s.featured).length).toBeGreaterThanOrEqual(4);
  });
});
