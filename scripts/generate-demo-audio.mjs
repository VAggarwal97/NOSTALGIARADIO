/**
 * Generates the local sample audio used by `demo: true` stations.
 *
 * The output is original synthesised material (warm pad chords, tape hiss and
 * crackle) so every player control can be exercised without licensing or
 * redistributing third-party music. Regenerate with `npm run demo:audio`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'audio');

const SAMPLE_RATE = 22050;
const DURATION = 60; // seconds per sample — matches DEMO_DURATION_SEC in src/data/songs.ts
const FREQUENCIES = 3;

// Deterministic pseudo-random so rebuilds are byte-identical.
let seed = 0x2f6e2b1;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

const CHORDS = [
  [220.0, 277.18, 329.63], // A minor-ish
  [196.0, 246.94, 293.66], // G
  [174.61, 220.0, 261.63], // F
  [164.81, 207.65, 246.94], // E
];

const render = (variant) => {
  const total = SAMPLE_RATE * DURATION;
  const samples = new Float32Array(total);
  const chordLength = Math.floor(total / CHORDS.length);

  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const chordIndex = Math.min(CHORDS.length - 1, Math.floor(i / chordLength));
    const local = (i % chordLength) / SAMPLE_RATE;
    const chord = CHORDS[chordIndex];

    // Envelope: gentle swell into each chord change.
    const swell = Math.min(1, local * 2) * Math.min(1, (chordLength / SAMPLE_RATE - local) * 2 + 0.35);

    let value = 0;
    for (let n = 0; n < chord.length; n += 1) {
      const freq = chord[n] * (1 + variant * 0.008);
      value += Math.sin(2 * Math.PI * freq * t) * (0.22 - n * 0.045);
      value += Math.sin(2 * Math.PI * freq * 2 * t + 0.4) * 0.03;
    }
    value *= swell * 0.55;

    // Tape hiss.
    value += random() * 0.012;

    // Occasional crackle.
    if (random() > 0.9994) value += random() * 0.35;

    // Slow tremolo, like a deck with tired belts.
    value *= 0.92 + 0.08 * Math.sin(2 * Math.PI * 0.7 * t);

    samples[i] = Math.max(-1, Math.min(1, value));
  }

  // Fade in/out to avoid clicks.
  const fade = Math.floor(SAMPLE_RATE * 0.35);
  for (let i = 0; i < fade; i += 1) {
    const gain = i / fade;
    samples[i] *= gain;
    samples[total - 1 - i] *= gain;
  }

  return samples;
};

const toWav = (samples) => {
  const bytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  return buffer;
};

fs.mkdirSync(OUT_DIR, { recursive: true });

['a', 'b', 'c'].forEach((name, index) => {
  const file = path.join(OUT_DIR, `demo-${name}.wav`);
  fs.writeFileSync(file, toWav(render(index / FREQUENCIES)));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  wrote ${path.relative(ROOT, file)} (${kb} KB)`);
});

console.log('  demo audio ready.');
