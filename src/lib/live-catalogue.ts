import { CATEGORIES, isCategoryId } from '../data/categories';
import { STATIONS } from '../data/stations';
import { SONGS } from '../data/songs';
import type { Category, CategoryId, Station } from '../types/station';
import { embedSourceForTrack } from './sourcePolicy';
import type { SourceDecision } from './sourcePolicy';
import { isSafeUrl } from './urlSafety';
import { isSupabaseConfigured } from './supabase-env';
import type { CatalogueStore } from './supabase-catalogue-store';

/**
 * The live catalogue — how `/admin` edits reach the public site.
 *
 * The bundled `src/data/*` catalogue is the *initial* (SSR / offline) view.
 * When Supabase is configured the site hydrates `categories`, `stations`,
 * `site_settings` and (lazily) `songs` at runtime and the database becomes the
 * source of truth: an edit, create or deactivate in the control room shows up
 * on the site without a rebuild. Realtime (migration 10) converges instantly;
 * a focus refetch covers offline stretches.
 *
 * Merge rule — honest hybrid: every field the database models is authoritative
 * when non-null; a null keeps the bundled value (the seed is the baseline, so
 * a fetch that returns rows can never *erase* data the schema does not carry
 * such as `titleLines` / `secondaryCategories`). A failed fetch keeps the
 * bundled catalogue entirely, and an empty station/category list is treated as
 * a failed fetch — the site never blanks itself.
 *
 * The typed category universe stays the bundled eight: admin rows for unknown
 * category slugs are ignored (widening `CategoryId` is a code change, not data).
 */

/** One song mapped to a station — its programme, straight from the rows. */
export interface ProgrammeSong {
  id: string;
  /** Station slug the song belongs to. */
  station: string;
  title: string;
  artist: string | null;
  artwork: string | null;
  /** Direct audio pointer, or null for provider rows. */
  audioUrl: string | null;
  provider: 'youtube' | 'spotify' | null;
  /** Provider-native video/track id for provider rows. */
  providerId: string | null;
  durationSec: number | null;
  sortOrder: number;
}

/** Raw `categories` rows as the store shaped them (already past RLS). */
export interface LiveCategoryRow {
  slug: string;
  name: string;
  tagline: string | null;
  icon: string | null;
  accent: string | null;
  flagship_slug: string | null;
  sort_order: number;
}

/** Raw `stations` rows as the store shaped them. */
export interface LiveStationRow {
  slug: string;
  category_slug: string | null;
  title: string;
  description: string | null;
  flagship: boolean;
  featured: boolean;
  demo: boolean;
  region: string | null;
  language: string[] | null;
  era: string | null;
  tags: string[] | null;
  artwork_url: string | null;
  backdrops: string[] | null;
  accent: string | null;
  source_url: string | null;
  audio_url: string | null;
  provider: 'youtube' | 'spotify' | null;
  playlist_url: string | null;
  action: 'play' | 'check' | 'request';
  source_type: 'external-site' | 'direct-audio' | 'embed';
  status: 'ready' | 'offline' | 'unknown';
  now_playing_title: string | null;
  now_playing_subtitle: string | null;
  sort_order: number;
}

export interface LiveCatalogueRows {
  categories: LiveCategoryRow[];
  stations: LiveStationRow[];
  settings: Record<string, string>;
}

export interface CatalogueSnapshot {
  /** Bumps on every applied change — components re-render through it. */
  version: number;
  stations: Station[];
  categories: Category[];
  /** Publicly visible `site_settings`, keyed by `setting_key`. */
  settings: Record<string, string>;
  source: 'bundled' | 'live';
}

const bundledSnapshot: CatalogueSnapshot = {
  version: 0,
  stations: STATIONS,
  categories: CATEGORIES,
  settings: {},
  source: 'bundled',
};

let snapshot: CatalogueSnapshot = bundledSnapshot;
const listeners = new Set<() => void>();

export const getCatalogue = (): CatalogueSnapshot => snapshot;

export function subscribeCatalogue(listener: () => void): () => void {
  listeners.add(listener);
  startLiveCatalogue();
  return () => {
    listeners.delete(listener);
  };
}

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

/** Runtime setting read — returns null until (unless) the site hydrates it. */
export function getSetting(key: string): string | null {
  const value = snapshot.settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Live category lookup; falls back to the bundled chips before hydration. */
export function getCategory(id: string | null | undefined): Category | undefined {
  if (!id) return undefined;
  return snapshot.categories.find((category) => category.id === id);
}

// ---------------------------------------------------------------------------
// Pure merge — unit-tested in tests/liveCatalogue.test.ts
// ---------------------------------------------------------------------------

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));

/**
 * Overlay the fetched station rows on the bundled catalogue.
 * Returns null when the fetch gave nothing trustworthy (keep the bundle).
 */
export function mergeStationRows(
  bundled: Station[],
  rows: LiveStationRow[],
): Station[] | null {
  if (rows.length === 0) return null;
  const baseBySlug = new Map(bundled.map((station, index) => [station.id, { station, index }]));
  const merged: Station[] = [];

  for (const row of rows) {
    const baseEntry = baseBySlug.get(row.slug);
    const base = baseEntry?.station;
    // A station must belong to a category this typed site knows how to render.
    const category = row.category_slug && KNOWN_CATEGORIES.has(row.category_slug)
      ? (row.category_slug as CategoryId)
      : base?.category;
    if (!category) continue;

    const station: Station = {
      ...(base ?? {}),
      id: row.slug,
      name: row.title,
      category,
      description: row.description ?? base?.description ?? '',
      artwork: row.artwork_url ?? base?.artwork ?? '',
      url: row.source_url ?? base?.url ?? '',
      action: row.action,
      sourceType: row.source_type,
      status: row.status,
      flagship: row.flagship,
      featured: row.featured,
      demo: row.demo,
      sortOrder: row.sort_order,
      ...(row.accent !== null ? { accent: row.accent } : {}),
      ...(row.backdrops !== null ? { backdrops: row.backdrops } : {}),
      ...(row.audio_url !== null ? { audioUrl: row.audio_url } : {}),
      ...(row.provider !== null && row.playlist_url !== null
        ? { provider: row.provider, playlistUrl: row.playlist_url }
        : {}),
      ...(row.region !== null ? { region: row.region } : {}),
      ...(row.language !== null ? { language: row.language } : {}),
      ...(row.era !== null ? { era: row.era } : {}),
      ...(row.tags !== null ? { tags: row.tags } : {}),
      ...(row.now_playing_title !== null
        ? {
            nowPlaying: {
              title: row.now_playing_title,
              subtitle: row.now_playing_subtitle ?? '',
            },
          }
        : {}),
    };
    merged.push(station);
  }

  if (merged.length === 0) return null;
  // Editorial order: the database's sort_order, bundled order breaking ties.
  const bundledIndex = new Map(bundled.map((station, index) => [station.id, index]));
  merged.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (bundledIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (bundledIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return merged;
}

/** Overlay fetched category rows; a missing row deactivates that chip. */
export function mergeCategoryRows(
  bundled: Category[],
  rows: LiveCategoryRow[],
): Category[] | null {
  if (rows.length === 0) return null;
  const baseById = new Map(bundled.map((category) => [category.id, category]));
  const merged: Category[] = [];
  for (const row of rows) {
    if (!isCategoryId(row.slug)) continue; // unknown slugs are not renderable here
    const base = baseById.get(row.slug);
    if (!base) continue;
    merged.push({
      ...base,
      label: row.name ?? base.label,
      tagline: row.tagline ?? base.tagline,
      icon: row.icon ?? base.icon,
      accent: row.accent ?? base.accent,
      flagship: row.flagship_slug ?? base.flagship,
    });
  }
  return merged.length > 0 ? merged : null;
}

// ---------------------------------------------------------------------------
// Programme — the songs mapped to one station
// ---------------------------------------------------------------------------

/** The bundled sample programme for a station (instant, offline-safe). */
export function bundledProgramme(stationId: string): ProgrammeSong[] {
  return SONGS.filter((song) => song.station === stationId).map((song, index) => ({
    id: `seed:${song.station}:${index}`,
    station: song.station,
    title: song.title,
    artist: null,
    artwork: song.artwork,
    audioUrl: song.audioUrl,
    provider: null,
    providerId: null,
    durationSec: song.durationSec,
    sortOrder: index,
  }));
}

/**
 * Where the player stands inside a programme: the loaded song's row, or —
 * while the station's own source plays — the row whose audio URL *is* that
 * source (the seed rows mirror the shipped wav files exactly).
 */
export function programmeIndexFor(
  programme: readonly ProgrammeSong[],
  current: ProgrammeSong | null,
  stationAudioUrl: string | null | undefined,
): number {
  if (current) {
    const byId = programme.findIndex((song) => song.id === current.id);
    if (byId !== -1) return byId;
  }
  if (stationAudioUrl) {
    const byUrl = programme.findIndex((song) => song.audioUrl === stationAudioUrl);
    if (byUrl !== -1) return byUrl;
  }
  return -1;
}

/** The next (or previous) song in the programme — wraps honestly, never null-musics. */
export function pickProgrammeNext(
  programme: readonly ProgrammeSong[],
  currentIndex: number,
  direction: 1 | -1,
): ProgrammeSong | null {
  if (programme.length === 0) return null;
  if (currentIndex < 0 || currentIndex >= programme.length) {
    return direction === 1 ? programme[0] : programme[programme.length - 1];
  }
  return programme[(currentIndex + direction + programme.length) % programme.length];
}

type PlayableDecision = Extract<SourceDecision, { kind: 'play' } | { kind: 'embed' }>;

/** The playback decision for one mapped song: provider row or direct audio. */
export function decisionForProgrammeSong(song: ProgrammeSong): PlayableDecision | null {
  if (song.provider && song.providerId) {
    const url =
      song.provider === 'youtube'
        ? `https://www.youtube.com/watch?v=${song.providerId}`
        : `https://open.spotify.com/track/${song.providerId}`;
    const source = embedSourceForTrack(song.provider, song.providerId, url);
    if (source) return { kind: 'embed', source };
  }
  const audio = song.audioUrl?.trim();
  if (audio && isSafeUrl(audio)) return { kind: 'play', audioUrl: audio };
  return null;
}

const programmeCache = new Map<string, ProgrammeSong[]>();
const programmeInflight = new Map<string, Promise<ProgrammeSong[] | null>>();
/** Bumped on every catalogue edit — an in-flight answer from before it is stale. */
let programmeGeneration = 0;

/**
 * The station's programme: the live rows when they answer, the bundled rows
 * as the honest fallback. A failed fetch is never cached — at boot this call
 * races the catalogue hydration (the slug→id map may not exist yet), and a
 * cached fallback would shadow the admin's rows forever. Failures return the
 * bundle and let the next selection or catalogue edit retry the live answer.
 * A successful empty list means the admin unmapped every song (the station
 * loops its own source).
 */
export async function loadProgramme(stationId: string): Promise<ProgrammeSong[]> {
  const cached = programmeCache.get(stationId);
  if (cached) return cached;
  let inflight = programmeInflight.get(stationId);
  if (!inflight) {
    const generation = programmeGeneration;
    inflight = (async () => {
      try {
        const store = await loadStore();
        if (!store) return null;
        return await store.fetchProgramme(stationId);
      } catch {
        return null;
      }
    })();
    programmeInflight.set(stationId, inflight);
    // Cache only what a post-edit fetch saw; a pre-edit answer returns to its
    // caller but never becomes the station's truth.
    void inflight.then((rows) => {
      if (rows !== null && generation === programmeGeneration) {
        programmeCache.set(stationId, rows);
      }
    });
  }
  const rows = await inflight.finally(() => {
    if (programmeInflight.get(stationId) === inflight) programmeInflight.delete(stationId);
  });
  if (rows === null) return bundledProgramme(stationId);
  return rows;
}

// ---------------------------------------------------------------------------
// Hydration loop
// ---------------------------------------------------------------------------

let storePromise: Promise<CatalogueStore | null> | null = null;

/** Dynamic import: the Supabase chunk stays out of the public bundle. */
const loadStore = (): Promise<CatalogueStore | null> => {
  if (typeof window === 'undefined' || !isSupabaseConfigured()) return Promise.resolve(null);
  storePromise ??= import('./supabase-catalogue-store')
    .then((module) => module.createBrowserCatalogueStore())
    .catch(() => null);
  return storePromise;
};

let started = false;
let lastRowsJson: string | null = null;
let refreshTimer: number | null = null;

/** Apply one trustworthy fetch. Pure input → snapshot, then subscribers run. */
export function applyLiveRows(rows: LiveCatalogueRows): void {
  const rowsJson = JSON.stringify(rows);
  if (rowsJson === lastRowsJson) return; // no change since the last fetch
  const stations = mergeStationRows(STATIONS, rows.stations);
  const categories = mergeCategoryRows(CATEGORIES, rows.categories);
  if (!stations && !categories) return; // nothing trustworthy — keep the bundle
  lastRowsJson = rowsJson;
  programmeGeneration += 1; // pre-edit in-flight answers may no longer cache
  programmeCache.clear(); // songs may have been re-mapped by the same edit
  programmeInflight.clear();
  snapshot = {
    version: snapshot.version + 1,
    stations: stations ?? snapshot.stations,
    categories: categories ?? snapshot.categories,
    settings: rows.settings,
    source: 'live',
  };
  emit();
}

let refreshInFlight = false;
/** Fetch + apply; failures silently keep the last known catalogue. */
export async function refreshLiveCatalogue(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const store = await loadStore();
    if (!store) return;
    const rows = await store.fetchCatalogue();
    if (rows) applyLiveRows(rows);
  } catch {
    /* offline or API trouble — the last known catalogue stays on screen */
  } finally {
    refreshInFlight = false;
  }
}

/** Idempotent, client-only: hydrate once, then follow realtime + focus. */
export function startLiveCatalogue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void (async () => {
    const store = await loadStore();
    if (!store) return;
    await refreshLiveCatalogue();
    store.subscribe(() => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshLiveCatalogue();
      }, 250);
    });
    window.addEventListener('focus', () => void refreshLiveCatalogue());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshLiveCatalogue();
    });
  })();
}
