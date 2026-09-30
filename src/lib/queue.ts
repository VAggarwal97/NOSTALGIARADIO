import type { SongRequest } from './request-api';
import { embedSourceForRequest } from './sourcePolicy';

/**
 * Boundaries the player reports to the community queue:
 *
 *  - `audio`         — a local sample track finished; if the queue has nothing
 *                      eligible, station rotation takes over.
 *  - `request`       — the request that was on air finished cleanly; it retires
 *                      to history and the next highest-voted one airs.
 *  - `manual`        — the listener pressed Next while a request played; same
 *                      hand-off, the request did air.
 *  - `station-embed` — a provider playlist changed video or rested at its end.
 *                      Only the queue may interrupt it; station rotation never
 *                      does, so playlists keep managing themselves.
 *  - `error`         — a request's source failed and was skipped this session.
 */
export type QueueOrigin = 'audio' | 'request' | 'station-embed' | 'manual' | 'error';

/** The pill, hero and dock address requests through this synthetic station id. */
export const requestStationId = (id: string): string => `request:${id}`;

/**
 * Which requests may air next: still open, not the one already on air, not
 * failed this session, and playable through an official provider embed.
 */
export const isQueueEligible = (
  request: SongRequest,
  skip: ReadonlySet<string>,
  currentId: string | null,
): boolean =>
  request.status === 'open' &&
  request.id !== currentId &&
  !skip.has(request.id) &&
  embedSourceForRequest(request) !== null;

/** First eligible request in board order (votes first) — the radio's next up. */
export const pickNextRequest = (
  items: readonly SongRequest[],
  skip: ReadonlySet<string>,
  currentId: string | null,
): SongRequest | null => items.find((item) => isQueueEligible(item, skip, currentId)) ?? null;

/**
 * A request retires to history only when it actually aired: a clean end or an
 * explicit Next. Failed and interrupted ones stay open for a later session.
 */
export const retireReason = (origin: QueueOrigin): 'played' | null =>
  origin === 'request' || origin === 'manual' ? 'played' : null;

/** After the queue is exhausted: rotate stations — except inside a playlist. */
export const fallsBackToStations = (origin: QueueOrigin): boolean => origin !== 'station-embed';

/**
 * When a fresh interaction (a submit, a vote, a Play click) may take the air
 * immediately: only while the radio has never started this session. Nothing is
 * loaded, so there is no current song to interrupt — and the click that got us
 * here is a live user gesture, so the engine is allowed to start. `paused` is
 * deliberate silence and stays respected; after the first start, boundaries rule.
 */
export const radioIsSilent = (status: string, hasRequestOnAir: boolean): boolean =>
  status === 'idle' && !hasRequestOnAir;
