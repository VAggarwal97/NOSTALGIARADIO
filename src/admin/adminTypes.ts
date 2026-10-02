/** Row shapes the admin panel reads — kept hand-written on purpose (the
 *  Supabase client is untyped; these describe what the migrations define). */

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'played';

export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = [
  'pending',
  'approved',
  'rejected',
  'played',
];

/** What the panel reads through the token-free `request_wall` view. */
export interface SuggestionRow {
  id: string;
  song_url: string | null;
  title: string;
  artist: string | null;
  description: string | null;
  artwork_url: string | null;
  status: SuggestionStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface ActivityRow {
  id: string;
  admin_email: string | null;
  action: string;
  entity_type: string | null;
  entity_label: string | null;
  created_at: string;
}

export type SettingValueType = 'text' | 'number' | 'boolean' | 'json';

export interface SettingRow {
  setting_key: string;
  setting_value: string;
  value_type: SettingValueType;
  publicly_visible: boolean;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  icon: string | null;
  accent: string | null;
  image_url: string | null;
  flagship_slug: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface StationRow {
  id: string;
  category_id: string | null;
  slug: string;
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
  accent: string | null;
  source_url: string | null;
  audio_url: string | null;
  provider: 'youtube' | 'spotify' | null;
  playlist_url: string | null;
  action: 'play' | 'check';
  source_type: 'external-site' | 'direct-audio' | 'embed';
  status: 'ready' | 'offline' | 'unknown';
  now_playing_title: string | null;
  now_playing_subtitle: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SongRow {
  id: string;
  station_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  year: number | null;
  language: string | null;
  duration_sec: number | null;
  audio_url: string | null;
  artwork_url: string | null;
  provider: 'youtube' | 'spotify' | null;
  provider_id: string | null;
  source_type: 'direct-audio' | 'hls' | 'stream' | 'youtube' | 'spotify';
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
