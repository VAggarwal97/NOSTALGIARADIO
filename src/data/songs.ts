import { STATIONS } from './stations';

/**
 * The station programme, as database rows.
 *
 * Every playable station's own local sample audio exists here as a real song
 * row — a file that actually ships in `public/audio/`, with the duration that
 * file really has (see `DURATION` in scripts/generate-demo-audio.mjs). This is
 * what makes the Songs catalogue, Up Next and the broadcast scheduler
 * functional on day one without inventing a single title, artist or length.
 *
 * Real licensed songs are added through the admin catalogue (or by extending
 * this list and re-running `npm run seed:sql`); nothing here is placeholder.
 */
export interface SeedSong {
  /** Station slug the song belongs to. */
  station: string;
  title: string;
  /** Local artwork path — the station's own scene art. */
  artwork: string;
  audioUrl: string;
  durationSec: number;
}

/** Must stay in sync with `DURATION` in scripts/generate-demo-audio.mjs. */
const DEMO_DURATION_SEC = 60;

export const SONGS: SeedSong[] = STATIONS.filter(
  (station) => station.action === 'play' && station.audioUrl,
).map((station) => {
  const letter = /demo-([abc])\.wav$/.exec(station.audioUrl ?? '')?.[1]?.toUpperCase() ?? 'A';
  return {
    station: station.id,
    title: `Demo Tape ${letter}`,
    artwork: station.artwork,
    audioUrl: station.audioUrl as string,
    durationSec: DEMO_DURATION_SEC,
  };
});
