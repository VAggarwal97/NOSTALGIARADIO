import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SONGS } from '../src/data/songs';

/**
 * The catalogue's day-one honesty pin: every song row whose audio is a local
 * wav must claim the length that file really has. If the generator's DURATION
 * and the seed drift apart, the scheduler would advance at the wrong second —
 * so the measured bytes, not the declared constant, are the authority here.
 */

/** Byte-level duration: dataSize / byteRate from the RIFF fmt/data chunks. */
function wavDurationSec(path: string): number {
  const buffer = readFileSync(path);
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buffer.subarray(8, 12).toString('ascii')).toBe('WAVE');

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      byteRate = buffer.readUInt32LE(offset + 8 + 8); // after format/channels/rate
    } else if (id === 'data') {
      dataSize = size;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  expect(byteRate).toBeGreaterThan(0);
  expect(dataSize).toBeGreaterThan(0);
  return dataSize / byteRate;
}

describe('seeded songs match the audio files that ship', () => {
  it('every local wav row exists and lasts exactly what the row claims', () => {
    const wavRows = SONGS.filter((song) => song.audioUrl.endsWith('.wav'));
    expect(wavRows.length).toBeGreaterThan(0);

    for (const song of wavRows) {
      const file = join(process.cwd(), 'public', song.audioUrl.replace(/^\//, ''));
      const measured = wavDurationSec(file);
      expect(
        Math.abs(measured - song.durationSec),
        `${song.title} (${song.audioUrl}): file says ${measured}s, row says ${song.durationSec}s`,
      ).toBeLessThan(0.05);
    }
  });

  it('the wav set actually shipped is the set the songs reference', () => {
    const shipped = readdirSync(join(process.cwd(), 'public', 'audio'))
      .filter((name) => name.endsWith('.wav'))
      .sort();
    const referenced = [...new Set(
      SONGS.filter((song) => song.audioUrl.endsWith('.wav')).map((song) =>
        song.audioUrl.replace(/^\/audio\//, ''),
      ),
    )].sort();
    expect(referenced).toEqual(shipped);
  });

  it('song keys stay unique per station (the (station,title) upsert pin)', () => {
    const keys = SONGS.map((song) => `${song.station}:${song.title}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
