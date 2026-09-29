import type { SongRef, TrackMeta } from './request-api';

/**
 * Track metadata for the community wall — resolved from the provider's own
 * oEmbed endpoint (YouTube and Spotify both answer with CORS). The URL is the
 * single source of truth: nobody types a title, artist or artwork by hand,
 * and nothing here is ever invented.
 *
 * Failure is honest:
 *   - `unavailable` → the provider refused (deleted, private, region-blocked)
 *   - `network`     → we couldn't reach the provider right now
 */

export type MetaResult = { ok: true; meta: TrackMeta } | { ok: false; reason: 'unavailable' | 'network' };

const TIMEOUT_MS = 8000;

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const endpointFor = (song: SongRef): string =>
  song.provider === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(song.url)}`
    : `https://open.spotify.com/oembed?url=${encodeURIComponent(song.url)}`;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export async function resolveTrackMeta(song: SongRef, fetcher: FetchLike = fetch): Promise<MetaResult> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(endpointFor(song), controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      return { ok: false, reason: response.status >= 500 ? 'network' : 'unavailable' };
    }
    const data = (await response.json()) as Record<string, unknown>;
    const title = asText(data.title);
    // No title → no request: the wall never shows a hollow card.
    if (!title) return { ok: false, reason: 'unavailable' };

    const artist = asText(data.author_name) || 'Unknown artist';
    const artwork =
      asText(data.thumbnail_url) ||
      // YouTube thumbnails are derivable from the video ID even if oEmbed omits one.
      (song.provider === 'youtube' ? `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg` : null);

    return { ok: true, meta: { title, artist, artwork } };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
