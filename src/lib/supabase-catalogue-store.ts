import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  LiveCatalogueRows,
  LiveCategoryRow,
  LiveStationRow,
  ProgrammeSong,
} from './live-catalogue';
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from './supabase-env';

/**
 * The Supabase implementation of the live catalogue — PostgREST reads and
 * realtime change signals only, always as `anon` under RLS (migration 10 adds
 * the four tables to `supabase_realtime`; visibility is still exactly what the
 * public policies allow: active categories/stations/songs, visible settings).
 *
 * What it deliberately does NOT do:
 *
 *  - never writes — edits happen in /admin, this side only reads;
 *  - never invents a title, slug or setting; invalid rows are dropped;
 *  - never references a service-role key.
 */

export interface CatalogueStore {
  /** Categories + stations + public settings, or null when anything failed. */
  fetchCatalogue(): Promise<LiveCatalogueRows | null>;
  /** One station's mapped songs (paginated per station), or null on failure. */
  fetchProgramme(stationSlug: string): Promise<ProgrammeSong[] | null>;
  /** Realtime: fires when any catalogue table changes (debounced by caller). */
  subscribe(listener: () => void): () => void;
}

const isStr = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const strArrayOrNull = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string') && value.length > 0
    ? (value as string[])
    : null;

const CATEGORY_COLUMNS =
  'slug,name,tagline,icon,accent,flagship_slug,sort_order';
const STATION_COLUMNS =
  'id,slug,category:category_id(slug),title,description,flagship,featured,demo,region,language,era,tags,artwork_url,backdrops,accent,source_url,audio_url,provider,playlist_url,action,source_type,status,now_playing_title,now_playing_subtitle,sort_order';

const VALID_ACTIONS = new Set(['play', 'check', 'request']);
const VALID_SOURCE_TYPES = new Set(['external-site', 'direct-audio', 'embed']);
const VALID_STATUSES = new Set(['ready', 'offline', 'unknown']);

/** Shape a raw `stations` row; null when any required field is not honest. */
const toStationRow = (raw: Record<string, unknown>): LiveStationRow | null => {
  const slug = raw.slug;
  const title = raw.title;
  const action = raw.action;
  const sourceType = raw.source_type;
  const status = raw.status;
  if (!isStr(slug) || !isStr(title)) return null;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) return null;
  if (typeof sourceType !== 'string' || !VALID_SOURCE_TYPES.has(sourceType)) return null;
  if (typeof status !== 'string' || !VALID_STATUSES.has(status)) return null;

  const category = raw.category as { slug?: unknown } | { slug?: unknown }[] | null;
  const categorySlug =
    category && !Array.isArray(category) && isStr(category.slug) ? category.slug : null;
  const provider = raw.provider === 'youtube' || raw.provider === 'spotify' ? raw.provider : null;
  const playlistUrl = strOrNull(raw.playlist_url);
  const backdrops = strArrayOrNull(raw.backdrops);

  return {
    slug,
    category_slug: categorySlug,
    title,
    description: strOrNull(raw.description),
    flagship: raw.flagship === true,
    featured: raw.featured === true,
    demo: raw.demo === true,
    region: strOrNull(raw.region),
    language: strArrayOrNull(raw.language),
    era: strOrNull(raw.era),
    tags: strArrayOrNull(raw.tags),
    artwork_url: strOrNull(raw.artwork_url),
    backdrops: Array.isArray(backdrops) ? (backdrops.slice(0, 12) as string[]) : null,
    accent: strOrNull(raw.accent),
    source_url: strOrNull(raw.source_url),
    audio_url: strOrNull(raw.audio_url),
    provider,
    playlist_url: provider ? playlistUrl : null,
    action: action as LiveStationRow['action'],
    source_type: sourceType as LiveStationRow['source_type'],
    status: status as LiveStationRow['status'],
    now_playing_title: strOrNull(raw.now_playing_title),
    now_playing_subtitle: strOrNull(raw.now_playing_subtitle),
    sort_order: typeof raw.sort_order === 'number' && raw.sort_order >= 0 ? raw.sort_order : 0,
  };
};

const toCategoryRow = (raw: Record<string, unknown>): LiveCategoryRow | null => {
  if (!isStr(raw.slug) || !isStr(raw.name)) return null;
  return {
    slug: raw.slug,
    name: raw.name,
    tagline: strOrNull(raw.tagline),
    icon: strOrNull(raw.icon),
    accent: strOrNull(raw.accent),
    flagship_slug: strOrNull(raw.flagship_slug),
    sort_order: typeof raw.sort_order === 'number' && raw.sort_order >= 0 ? raw.sort_order : 0,
  };
};

export function createBrowserCatalogueStore(): CatalogueStore | null {
  if (!isSupabaseConfigured()) return null;
  const client: SupabaseClient = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** slug → uuid, built by fetchCatalogue so songs can query by station_id. */
  const stationIds = new Map<string, string>();

  const fetchCatalogue = async (): Promise<LiveCatalogueRows | null> => {
    const [categoriesRes, stationsRes, settingsRes] = await Promise.all([
      client.from('categories').select(CATEGORY_COLUMNS).eq('active', true).order('sort_order'),
      client.from('stations').select(STATION_COLUMNS).eq('active', true).order('sort_order'),
      // Only flagged keys are the public site's business (the column's own
      // contract); the open panel can read everything, this side will not.
      client.from('site_settings').select('setting_key,setting_value').eq('publicly_visible', true),
    ]);
    if (categoriesRes.error || stationsRes.error || settingsRes.error) return null;
    if (!Array.isArray(categoriesRes.data) || !Array.isArray(stationsRes.data)) return null;

    const categories = (categoriesRes.data as Record<string, unknown>[])
      .map(toCategoryRow)
      .filter((row): row is LiveCategoryRow => row !== null);
    const stations = (stationsRes.data as Record<string, unknown>[])
      .map(toStationRow)
      .filter((row): row is LiveStationRow => row !== null);

    stationIds.clear();
    (stationsRes.data as Record<string, unknown>[]).forEach((raw) => {
      if (isStr(raw.slug) && isStr(raw.id)) stationIds.set(raw.slug, raw.id);
    });

    const settings: Record<string, string> = {};
    if (Array.isArray(settingsRes.data)) {
      for (const raw of settingsRes.data as Record<string, unknown>[]) {
        if (isStr(raw.setting_key) && typeof raw.setting_value === 'string') {
          settings[raw.setting_key] = raw.setting_value;
        }
      }
    }

    return { categories, stations, settings };
  };

  const fetchProgramme = async (stationSlug: string): Promise<ProgrammeSong[] | null> => {
    const stationId = stationIds.get(stationSlug);
    if (!stationId) return null;
    const { data, error } = await client
      .from('songs')
      .select('id,title,artist,audio_url,artwork_url,provider,provider_id,duration_sec,sort_order')
      .eq('station_id', stationId)
      .eq('active', true)
      .order('sort_order')
      .limit(100);
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[])
      .map((raw, index): ProgrammeSong | null => {
        if (!isStr(raw.id) || !isStr(raw.title)) return null; // never air an untitled row
        const provider = raw.provider === 'youtube' || raw.provider === 'spotify' ? raw.provider : null;
        return {
          id: raw.id,
          station: stationSlug,
          title: raw.title,
          artist: strOrNull(raw.artist),
          artwork: strOrNull(raw.artwork_url),
          audioUrl: strOrNull(raw.audio_url),
          provider,
          providerId: provider && isStr(raw.provider_id) ? raw.provider_id : null,
          durationSec:
            typeof raw.duration_sec === 'number' && raw.duration_sec >= 0
              ? raw.duration_sec
              : null,
          sortOrder:
            typeof raw.sort_order === 'number' && raw.sort_order >= 0 ? raw.sort_order : index,
        };
      })
      .filter((song): song is ProgrammeSong => song !== null);
  };

  const subscribe = (listener: () => void): (() => void) => {
    // One channel, one listener per published catalogue table (migration 10).
    // RLS still decides which change events this anon key may receive; the
    // callback only triggers a refetch — the payload itself is never trusted.
    const channel = client
      .channel('catalogue-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, listener)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stations' }, listener)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, listener)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'songs' }, listener)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  };

  return { fetchCatalogue, fetchProgramme, subscribe };
}
