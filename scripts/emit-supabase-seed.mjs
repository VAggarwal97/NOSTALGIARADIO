/**
 * Emits `supabase/migrations/*_seed_catalogue.sql` from the TypeScript
 * catalogue — categories and stations stay code-owned (single source of
 * truth, reviewable in Git), and the database seed is regenerated from it:
 *
 *   npm run seed:sql
 *
 * The emitted SQL is idempotent (`on conflict ... do update`), so re-running
 * it refreshes catalogue fields in place and never touches community data
 * (suggestions / votes). Every value is validated against the exact CHECK
 * constraints of `00000000000001`-style schema migration first, so a bad
 * catalogue entry fails loudly here instead of erroring mid-paste in the
 * Supabase SQL Editor.
 *
 * `tests/supabaseSeed.test.ts` asserts the committed SQL matches what this
 * script generates — edit src/data/*, re-run `npm run seed:sql`, and CI
 * stays green.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'supabase/migrations/20260930000003_seed_catalogue.sql';
// SEED_OUT lets tests (and dry runs) redirect the output instead of touching
// the committed file.
const OUT = process.env.SEED_OUT ? resolve(process.env.SEED_OUT) : join(ROOT, OUT_REL);

/** Keep these in sync with 20260930000001_foundation_schema.sql — same rules,
 *  checked before emission so the seed can never violate them. */
const SLUG = /^[a-z0-9-]+$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HTTPS = /^https:\/\//;
const L = {
  catName: [1, 80],
  catTagline: [1, 300],
  catIcon: [1, 8],
  stationTitle: [1, 120],
  stationDescription: [1, 700],
  region: [1, 100],
  era: [1, 60],
  artwork: [1, 500],
  sourceUrl: [1, 1000],
  audioUrl: [1, 1000],
  playlistUrl: [1, 1000],
  nowTitle: [1, 200],
  nowSubtitle: [1, 240],
  songTitle: [1, 300],
};

const fail = (where, message) => {
  throw new Error(`seed: ${where}: ${message}`);
};

const checkLen = (where, value, [min, max]) => {
  if (value == null) return;
  const n = [...String(value)].length;
  if (n < min || n > max) fail(where, `length ${n} outside ${min}..${max}`);
};

const sqlStr = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlText = (value) => (value == null || value === '' ? 'null' : sqlStr(value));
const sqlArray = (items) => {
  if (!Array.isArray(items) || items.length === 0) return 'null';
  for (const item of items) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 60) {
      fail('array item', `expected non-empty string ≤60 chars, got ${JSON.stringify(item)}`);
    }
  }
  return `array[${items.map(sqlStr).join(', ')}]`;
};
const sqlJsonb = (value) =>
  value == null || value.length === 0
    ? 'null'
    : `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

/** Bundle the typed catalogue through esbuild and import it in this process. */
export async function loadCatalogue() {
  const entry = [
    `export { CATEGORIES } from ${JSON.stringify(join(ROOT, 'src', 'data', 'categories.ts'))};`,
    `export { STATIONS } from ${JSON.stringify(join(ROOT, 'src', 'data', 'stations.ts'))};`,
    `export { SONGS } from ${JSON.stringify(join(ROOT, 'src', 'data', 'songs.ts'))};`,
  ].join('\n');

  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: ROOT,
      sourcefile: 'catalogue-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });

  const file = join(
    tmpdir(),
    `nostalgia-catalogue-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.outputFiles[0].text, 'utf8');
  // Cache-busting query: a watch/test process may load this twice.
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
}

/** Validates the catalogue against the schema CHECKs. Returns used lengths. */
function validate(CATEGORIES, STATIONS, SONGS) {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const stats = { categories: CATEGORIES.length, stations: STATIONS.length, maxDescription: 0, maxTitle: 0 };

  CATEGORIES.forEach((category, index) => {
    const where = `category[${index}] '${category.id}'`;
    if (!SLUG.test(category.id)) fail(where, 'slug must match ^[a-z0-9-]+$');
    checkLen(`${where} label`, category.label, L.catName);
    checkLen(`${where} tagline`, category.tagline, L.catTagline);
    checkLen(`${where} icon`, category.icon, L.catIcon);
    if (category.accent && !HEX.test(category.accent)) fail(where, `accent '${category.accent}' not #rrggbb`);
    if (category.flagship && !STATIONS.some((s) => s.id === category.flagship)) {
      fail(where, `flagship '${category.flagship}' is not a station`);
    }
  });

  STATIONS.forEach((station, index) => {
    const where = `station[${index}] '${station.id}'`;
    if (!SLUG.test(station.id)) fail(where, 'slug must match ^[a-z0-9-]+$');
    if (!ids.has(station.category)) fail(where, `category '${station.category}' not in CATEGORIES`);
    checkLen(`${where} name`, station.name, L.stationTitle);
    checkLen(`${where} description`, station.description, L.stationDescription);
    checkLen(`${where} region`, station.region, L.region);
    checkLen(`${where} era`, station.era, L.era);
    checkLen(`${where} artwork`, station.artwork, L.artwork);
    checkLen(`${where} nowPlaying.title`, station.nowPlaying?.title, L.nowTitle);
    checkLen(`${where} nowPlaying.subtitle`, station.nowPlaying?.subtitle, L.nowSubtitle);
    if (station.accent && !HEX.test(station.accent)) fail(where, `accent '${station.accent}' not #rrggbb`);
    if (station.url && !HTTPS.test(station.url)) fail(where, `url '${station.url}' must be https`);
    checkLen(`${where} url`, station.url, L.sourceUrl);
    if (station.audioUrl) checkLen(`${where} audioUrl`, station.audioUrl, L.audioUrl);
    if (station.playlistUrl && !HTTPS.test(station.playlistUrl)) {
      fail(where, `playlistUrl '${station.playlistUrl}' must be https`);
    }
    if ((station.provider == null) !== (station.playlistUrl == null)) {
      fail(where, 'provider and playlistUrl must be set together');
    }
    if (station.backdrops) {
      if (station.backdrops.length > 12) fail(where, 'more than 12 backdrops');
      for (const backdrop of station.backdrops) {
        // Self-hosted /img paths ship alongside real https URLs (issue 6:
        // no third-party hotlinks for the hero stage).
        if (!HTTPS.test(backdrop) && !/^\/[^\s'"`<>]+$/.test(backdrop)) {
          fail(where, `backdrop '${backdrop}' must be https or a local /path`);
        }
      }
    }
    stats.maxDescription = Math.max(stats.maxDescription, [...(station.description ?? '')].length);
    stats.maxTitle = Math.max(stats.maxTitle, [...station.name].length);
  });

  const stationIds = new Set(STATIONS.map((s) => s.id));
  const seenSongs = new Set();
  SONGS.forEach((song, index) => {
    const where = `song[${index}] '${song.station}/${song.title}'`;
    if (!stationIds.has(song.station)) fail(where, `station '${song.station}' is not a station`);
    checkLen(`${where} title`, song.title, L.songTitle);
    checkLen(`${where} audioUrl`, song.audioUrl, L.audioUrl);
    checkLen(`${where} artwork`, song.artwork, L.artwork);
    if (!Number.isInteger(song.durationSec) || song.durationSec < 0) {
      fail(where, `durationSec '${song.durationSec}' must be a non-negative integer`);
    }
    if (song.audioUrl && !(song.audioUrl.startsWith('/') || song.audioUrl.startsWith('https://'))) {
      fail(where, `audioUrl '${song.audioUrl}' must be a local /path or https URL`);
    }
    // The schema's natural key (station_id, title) — mirrored here so a
    // duplicate fails loudly at generation instead of mid-paste in SQL.
    const key = `${song.station}/${song.title}`;
    if (seenSongs.has(key)) fail(where, `duplicates '${key}' (songs_station_title_key)`);
    seenSongs.add(key);
  });

  return stats;
}

export async function generateSeedSql() {
  const { CATEGORIES, STATIONS, SONGS } = await loadCatalogue();
  validate(CATEGORIES, STATIONS, SONGS);

  const header = [
    `-- Generated by \`npm run seed:sql\` from src/data/categories.ts, stations.ts + songs.ts.`,
    `-- DO NOT EDIT BY HAND — edit the TypeScript catalogue and regenerate.`,
    `-- Idempotent: re-running refreshes catalogue fields in place and never touches`,
    `-- community data (suggestions / votes / station_events).`,
    `-- ${CATEGORIES.length} categories · ${STATIONS.length} stations.`,
    `-- ${SONGS.length} songs — the local sample programme (one real shipped file per`,
    `-- playable station, with that file's actual duration).`,
    ``,
    `insert into public.categories (slug, name, tagline, icon, accent, flagship_slug, sort_order, active)`,
    `values`,
  ];

  const categoryValues = CATEGORIES.map((category, index) =>
    [
      `  (${sqlStr(category.id)}, ${sqlStr(category.label)}, ${sqlText(category.tagline)},`,
      `   ${sqlText(category.icon)}, ${sqlText(category.accent)}, ${sqlText(category.flagship)},`,
      `   ${index + 1}, true)`,
    ].join('\n'),
  );
  const categories =
    header.concat(
      categoryValues.join(',\n'),
      `on conflict (slug) do update set`,
      `  name = excluded.name, tagline = excluded.tagline, icon = excluded.icon,`,
      `  accent = excluded.accent, flagship_slug = excluded.flagship_slug,`,
      `  sort_order = excluded.sort_order, active = excluded.active;`,
      ``,
    );

  const stationColumns = [
    'slug', 'category_id', 'title', 'description', 'flagship', 'featured', 'demo',
    'region', 'language', 'era', 'tags', 'artwork_url', 'backdrops', 'accent',
    'source_url', 'audio_url', 'provider', 'playlist_url',
    'action', 'source_type', 'status', 'now_playing_title', 'now_playing_subtitle',
    'sort_order', 'active',
  ];

  const stationSelects = STATIONS.map((station, index) => {
    const values = [
      sqlStr(station.id),
      'c.id',
      sqlStr(station.name),
      sqlText(station.description),
      String(Boolean(station.flagship)),
      String(Boolean(station.featured)),
      String(Boolean(station.demo)),
      sqlText(station.region),
      sqlArray(station.language),
      sqlText(station.era),
      sqlArray(station.tags),
      sqlText(station.artwork),
      sqlJsonb(station.backdrops),
      sqlText(station.accent),
      sqlText(station.url),
      sqlText(station.audioUrl),
      station.provider ? sqlStr(station.provider) : 'null',
      sqlText(station.playlistUrl),
      sqlStr(station.action),
      sqlStr(station.sourceType),
      // Code silence is meaningful: a playable, CI-validated station is ready;
      // a not-on-air station is honestly 'unknown' until a source arrives.
      sqlStr(station.status ?? (station.action === 'request' ? 'unknown' : 'ready')),
      sqlText(station.nowPlaying?.title),
      sqlText(station.nowPlaying?.subtitle),
      String(index + 1),
      'true',
    ];
    return [
      `select ${values.join(', ')}`,
      `from public.categories c where c.slug = ${sqlStr(station.category)}`,
    ].join('\n');
  });

  const stations = [
    `insert into public.stations (${stationColumns.join(', ')})`,
    stationSelects.join('\nunion all\n'),
    `on conflict (slug) do update set`,
    `  category_id = excluded.category_id, title = excluded.title,`,
    `  description = excluded.description, flagship = excluded.flagship,`,
    `  featured = excluded.featured, demo = excluded.demo, region = excluded.region,`,
    `  language = excluded.language, era = excluded.era, tags = excluded.tags,`,
    `  artwork_url = excluded.artwork_url, backdrops = excluded.backdrops,`,
    `  accent = excluded.accent, source_url = excluded.source_url,`,
    `  audio_url = excluded.audio_url, provider = excluded.provider,`,
    `  playlist_url = excluded.playlist_url, action = excluded.action,`,
    `  source_type = excluded.source_type, status = excluded.status,`,
    `  now_playing_title = excluded.now_playing_title,`,
    `  now_playing_subtitle = excluded.now_playing_subtitle,`,
    `  sort_order = excluded.sort_order, active = excluded.active;`,
    ``,
  ];

  const songs = [
    `insert into public.songs (station_id, title, duration_sec, audio_url, artwork_url, source_type, sort_order, active)`,
    SONGS.map((song) =>
      [
        `select (select id from public.stations where slug = ${sqlStr(song.station)}),`,
        `       ${sqlStr(song.title)}, ${song.durationSec}, ${sqlText(song.audioUrl)},`,
        `       ${sqlText(song.artwork)}, 'direct-audio', 1, true`,
      ].join('\n'),
    ).join('\nunion all\n'),
    `on conflict (station_id, title) do update set`,
    `  duration_sec = excluded.duration_sec, audio_url = excluded.audio_url,`,
    `  artwork_url = excluded.artwork_url, source_type = excluded.source_type,`,
    `  sort_order = excluded.sort_order, active = excluded.active;`,
    ``,
  ];

  return `${categories.join('\n')}\n${stations.join('\n')}\n${songs.join('\n')}`;
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  generateSeedSql()
    .then((sql) => {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, sql, 'utf8');
      const stations = (sql.match(/^select '/gm) ?? []).length;
      console.log(`wrote ${OUT === join(ROOT, OUT_REL) ? OUT_REL : OUT} (${stations} stations)`);
    })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exit(1);
    });
}
