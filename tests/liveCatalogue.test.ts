import { describe, expect, it } from 'vitest';

import { CATEGORIES } from '../src/data/categories';
import { STATIONS } from '../src/data/stations';
import {
  applyLiveRows,
  bundledProgramme,
  decisionForProgrammeSong,
  getCatalogue,
  getCategory,
  getSetting,
  loadProgramme,
  mergeCategoryRows,
  mergeStationRows,
  pickProgrammeNext,
  programmeIndexFor,
} from '../src/lib/live-catalogue';
import type {
  LiveCategoryRow,
  LiveCatalogueRows,
  LiveStationRow,
  ProgrammeSong,
} from '../src/lib/live-catalogue';

// ---------------------------------------------------------------------------
// Fixtures — raw rows exactly as the Supabase store shapes them
// ---------------------------------------------------------------------------

const stationRow = (overrides: Partial<LiveStationRow> = {}): LiveStationRow => ({
  slug: 'fresh-station',
  category_slug: 'mix',
  title: 'Fresh Station',
  description: null,
  flagship: false,
  featured: false,
  demo: false,
  region: null,
  language: null,
  era: null,
  tags: null,
  artwork_url: null,
  backdrops: null,
  accent: null,
  source_url: null,
  audio_url: null,
  provider: null,
  playlist_url: null,
  action: 'play',
  source_type: 'direct-audio',
  status: 'ready',
  now_playing_title: null,
  now_playing_subtitle: null,
  sort_order: 40,
  ...overrides,
});

const categoryRow = (overrides: Partial<LiveCategoryRow> = {}): LiveCategoryRow => ({
  slug: 'mix',
  name: 'MIX',
  tagline: null,
  icon: null,
  accent: null,
  flagship_slug: null,
  sort_order: 1,
  ...overrides,
});

const rows = (partial: Partial<LiveCatalogueRows>): LiveCatalogueRows => ({
  categories: [categoryRow()],
  stations: [stationRow()],
  settings: {},
  ...partial,
});

// ---------------------------------------------------------------------------
// Station merge — the honest hybrid (issue 1)
// ---------------------------------------------------------------------------

describe('mergeStationRows', () => {
  it('never blanks the site: an empty row list keeps the bundled catalogue', () => {
    expect(mergeStationRows(STATIONS, [])).toBeNull();
  });

  it('drops bundled stations the fetch did not return (deactivated in admin)', () => {
    const base = STATIONS[0];
    const merged = mergeStationRows(STATIONS, [
      stationRow({ slug: base.id, category_slug: base.category, title: base.name }),
    ]);
    expect(merged).not.toBeNull();
    expect(merged).toHaveLength(1);
    expect(merged?.[0].id).toBe(base.id);
  });

  it('overlays every field the database models on top of the bundled base', () => {
    const base = STATIONS.find((station) => station.backdrops?.length) ?? STATIONS[0];
    const merged = mergeStationRows(STATIONS, [
      stationRow({
        slug: base.id,
        category_slug: base.category,
        title: 'Edited Name',
        description: 'Edited description.',
        artwork_url: '/art/edited.svg',
        source_url: 'https://example.com/source',
        region: 'Kerala',
        era: '80s',
        flagship: true,
        featured: true,
        action: 'check',
        source_type: 'external-site',
        status: 'offline',
        sort_order: 7,
        now_playing_title: 'On air now',
        now_playing_subtitle: 'the good hours',
      }),
    ]);
    const station = merged?.[0];
    expect(station).toBeDefined();
    expect(station?.name).toBe('Edited Name');
    expect(station?.description).toBe('Edited description.');
    expect(station?.artwork).toBe('/art/edited.svg');
    expect(station?.url).toBe('https://example.com/source');
    expect(station?.region).toBe('Kerala');
    expect(station?.era).toBe('80s');
    expect(station?.flagship).toBe(true);
    expect(station?.featured).toBe(true);
    expect(station?.action).toBe('check');
    expect(station?.sourceType).toBe('external-site');
    expect(station?.status).toBe('offline');
    expect(station?.sortOrder).toBe(7);
    expect(station?.nowPlaying).toEqual({ title: 'On air now', subtitle: 'the good hours' });
  });

  it('keeps fields the schema does not carry (titleLines, secondaryCategories, backdrops)', () => {
    const base = STATIONS.find((station) => station.titleLines);
    expect(base).toBeDefined();
    const merged = mergeStationRows(STATIONS, [
      stationRow({
        slug: base!.id,
        category_slug: base!.category,
        title: base!.name,
        description: base!.description,
        // DB backdrops null → the bundled stage photos survive.
        backdrops: null,
      }),
    ]);
    const station = merged?.[0];
    expect(station?.titleLines).toEqual(base!.titleLines);
    expect(station?.secondaryCategories).toEqual(base!.secondaryCategories);
    expect(station?.backdrops).toEqual(base!.backdrops);
  });

  it('a null column keeps the bundled value — a fetch can never erase data', () => {
    const base = STATIONS[0];
    const merged = mergeStationRows(STATIONS, [
      stationRow({
        slug: base.id,
        category_slug: base.category,
        title: base.name,
        description: null,
        artwork_url: null,
        source_url: null,
      }),
    ]);
    expect(merged?.[0].description).toBe(base.description);
    expect(merged?.[0].artwork).toBe(base.artwork);
    expect(merged?.[0].url).toBe(base.url);
  });

  it('ignores stations in unknown category slugs — the typed universe stays eight', () => {
    const merged = mergeStationRows(STATIONS, [
      stationRow({ slug: 'mystery-fm', category_slug: 'brand-new-category' }),
    ]);
    expect(merged).toBeNull();
  });

  it('accepts a brand-new station in a known category, with honest defaults', () => {
    const merged = mergeStationRows(STATIONS, [
      stationRow({ slug: 'fresh-station', category_slug: 'transit', title: 'Fresh FM' }),
    ]);
    const station = merged?.find((item) => item.id === 'fresh-station');
    expect(station).toBeDefined();
    expect(station?.category).toBe('transit');
    expect(station?.name).toBe('Fresh FM');
    expect(station?.description).toBe('');
    expect(station?.artwork).toBe('');
    expect(station?.titleLines).toBeUndefined();
  });

  it('orders by the database sort_order, bundled order breaking ties', () => {
    const first = STATIONS[0];
    const second = STATIONS[1];
    const merged = mergeStationRows(STATIONS, [
      stationRow({ slug: first.id, category_slug: first.category, title: first.name, sort_order: 5 }),
      stationRow({ slug: 'fresh-one', category_slug: 'mix', title: 'Fresh One', sort_order: 1 }),
      stationRow({ slug: second.id, category_slug: second.category, title: second.name, sort_order: 9 }),
    ]);
    expect(merged?.map((station) => station.id)).toEqual([
      'fresh-one',
      first.id,
      second.id,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Category merge
// ---------------------------------------------------------------------------

describe('mergeCategoryRows', () => {
  it('never blanks the chips: empty rows keep the bundled categories', () => {
    expect(mergeCategoryRows(CATEGORIES, [])).toBeNull();
  });

  it('skips unknown slugs and deactivates chips missing from the fetch', () => {
    const merged = mergeCategoryRows(CATEGORIES, [
      categoryRow({ slug: 'transit', name: 'Transit Special', sort_order: 2 }),
      categoryRow({ slug: 'not-a-known-chip', name: 'Mystery' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged?.[0].id).toBe('transit');
    expect(merged?.[0].label).toBe('Transit Special');
    expect(merged?.[0].shortLabel).toBe(CATEGORIES.find((c) => c.id === 'transit')?.shortLabel);
  });

  it('overlays name, tagline, accent and flagship from the row', () => {
    const base = CATEGORIES[0];
    const merged = mergeCategoryRows(CATEGORIES, [
      categoryRow({
        slug: base.id,
        name: 'Renamed',
        tagline: 'A new line',
        accent: '#123456',
        flagship_slug: 'some-station',
        sort_order: 1,
      }),
    ]);
    expect(merged?.[0].label).toBe('Renamed');
    expect(merged?.[0].tagline).toBe('A new line');
    expect(merged?.[0].accent).toBe('#123456');
    expect(merged?.[0].flagship).toBe('some-station');
    expect(merged?.[0].icon).toBe(base.icon);
  });
});

// ---------------------------------------------------------------------------
// Programme helpers — the auto-advancing station queue (new feature)
// ---------------------------------------------------------------------------

describe('bundledProgramme', () => {
  it('maps only the given station’s sample rows, with the real shipped duration', () => {
    const station = STATIONS.find((item) => item.action === 'play' && item.audioUrl);
    expect(station).toBeDefined();
    const programme = bundledProgramme(station!.id);
    expect(programme.length).toBeGreaterThan(0);
    for (const song of programme) {
      expect(song.station).toBe(station!.id);
      expect(song.audioUrl).toBe(station!.audioUrl);
      expect(song.durationSec).toBe(60);
      expect(song.id).toMatch(/^seed:/);
    }
    expect(bundledProgramme('no-such-station')).toEqual([]);
  });
});

describe('programmeIndexFor', () => {
  const programme = bundledProgramme(
    (STATIONS.find((item) => item.action === 'play' && item.audioUrl) ?? STATIONS[0]).id,
  );

  it('finds the loaded song by id first', () => {
    const current = programme[0];
    expect(programmeIndexFor(programme, current, '/audio/other.wav')).toBe(0);
  });

  it('falls back to the station’s own audio source when no song is loaded', () => {
    expect(programmeIndexFor(programme, null, programme[0]?.audioUrl)).toBe(0);
  });

  it('returns -1 when nothing matches', () => {
    expect(programmeIndexFor(programme, null, '/audio/absent.wav')).toBe(-1);
    expect(programmeIndexFor([], null, null)).toBe(-1);
  });
});

describe('pickProgrammeNext', () => {
  const song = (index: number): ProgrammeSong => ({
    id: `s${index}`,
    station: 'st',
    title: `Song ${index}`,
    artist: null,
    artwork: null,
    audioUrl: `/audio/s${index}.wav`,
    provider: null,
    providerId: null,
    durationSec: 60,
    sortOrder: index,
  });
  const programme = [song(0), song(1), song(2)];

  it('walks forward and wraps honestly', () => {
    expect(pickProgrammeNext(programme, 0, 1)?.id).toBe('s1');
    expect(pickProgrammeNext(programme, 2, 1)?.id).toBe('s0');
  });

  it('walks backward and wraps honestly', () => {
    expect(pickProgrammeNext(programme, 0, -1)?.id).toBe('s2');
    expect(pickProgrammeNext(programme, 1, -1)?.id).toBe('s0');
  });

  it('starts at the ends when the player stands nowhere (index -1)', () => {
    expect(pickProgrammeNext(programme, -1, 1)?.id).toBe('s0');
    expect(pickProgrammeNext(programme, -1, -1)?.id).toBe('s2');
  });

  it('an empty programme is a null, never a phantom track', () => {
    expect(pickProgrammeNext([], 0, 1)).toBeNull();
  });
});

describe('decisionForProgrammeSong', () => {
  const base: ProgrammeSong = {
    id: 'x',
    station: 'st',
    title: 'Track',
    artist: null,
    artwork: null,
    audioUrl: null,
    provider: null,
    providerId: null,
    durationSec: null,
    sortOrder: 0,
  };

  it('builds a YouTube video embed from a provider row', () => {
    const decision = decisionForProgrammeSong({
      ...base,
      provider: 'youtube',
      providerId: 'abcdefghijk',
    });
    expect(decision?.kind).toBe('embed');
    if (decision?.kind === 'embed') {
      expect(decision.source.entity).toBe('video');
      expect(decision.source.playlistId).toBe('abcdefghijk');
    }
  });

  it('builds direct audio playback from a local row', () => {
    const decision = decisionForProgrammeSong({ ...base, audioUrl: '/audio/demo-a.wav' });
    expect(decision).toEqual({ kind: 'play', audioUrl: '/audio/demo-a.wav' });
  });

  it('refuses rows with nothing playable — the walker skips them', () => {
    expect(decisionForProgrammeSong(base)).toBeNull();
    expect(
      decisionForProgrammeSong({ ...base, audioUrl: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(
      decisionForProgrammeSong({ ...base, provider: 'youtube', providerId: 'short' }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshot + hydration apply
// ---------------------------------------------------------------------------

describe('applyLiveRows', () => {
  it('applies trustworthy rows, bumps the version and exposes settings', () => {
    const before = getCatalogue();
    expect(before.source).toBe('bundled');
    applyLiveRows(
      rows({
        categories: CATEGORIES.map((category, index) =>
          categoryRow({
            slug: category.id,
            name: category.label,
            sort_order: index + 1,
          }),
        ),
        stations: STATIONS.map((station, index) =>
          stationRow({
            slug: station.id,
            category_slug: station.category,
            title: station.name,
            description: station.description,
            sort_order: index + 1,
          }),
        ),
        settings: { donation_url: 'https://example.com/donate' },
      }),
    );
    const after = getCatalogue();
    expect(after.version).toBe(before.version + 1);
    expect(after.source).toBe('live');
    expect(after.settings.donation_url).toBe('https://example.com/donate');
    expect(getSetting('donation_url')).toBe('https://example.com/donate');
    expect(getSetting('missing_key')).toBeNull();
    expect(after.stations).toHaveLength(STATIONS.length);
    expect(getCategory('mix')?.label).toBe(CATEGORIES[0].label);
  });

  it('identical rows are a no-op — focus refetches never churn renders', () => {
    const same = rows({ settings: { donation_url: 'https://example.com/donate' } });
    applyLiveRows(same); // establish this JSON as the last applied one
    const before = getCatalogue();
    applyLiveRows(same);
    applyLiveRows(same);
    expect(getCatalogue().version).toBe(before.version);
    expect(getCatalogue()).toBe(before);
  });

  it('a row list that yields nothing trustworthy keeps the current snapshot', () => {
    const before = getCatalogue();
    applyLiveRows(rows({ categories: [], stations: [], settings: {} }));
    expect(getCatalogue()).toBe(before);
  });
});

describe('loadProgramme without a configured backend', () => {
  it('answers with the bundled rows immediately (no invented titles)', async () => {
    const station = STATIONS.find((item) => item.action === 'play' && item.audioUrl);
    const programme = await loadProgramme(station!.id);
    expect(programme).toEqual(bundledProgramme(station!.id));
  });
});
