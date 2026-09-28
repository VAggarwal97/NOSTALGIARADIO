/**
 * Generates the cinematic station artwork as local SVG scenes.
 *
 * Original procedural illustrations — no third-party images, no licensing surface,
 * ~4-14 kB each. Each scene is a wide 1600x900 composition with negative space on
 * the left for hero titles, layered silhouettes, warm Indian-street colour grading,
 * film grain and a vignette. Regenerate with `npm run art`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'art');

const W = 1600;
const H = 900;

const C = {
  night: '#0B0807',
  wine: '#4B1717',
  wineDeep: '#2A0E0E',
  terracotta: '#A94A38',
  amber: '#D7A451',
  amberPale: '#F0D8A6',
  ivory: '#F4EBDD',
  smoke: '#1D1511',
};

const round = (n) => Math.round(n * 10) / 10;

/** Warm graded sky + reusable filters. */
const defs = (id, horizon = 0.62) => `
  <defs>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.wineDeep}"/>
      <stop offset="${round(horizon - 0.22)}" stop-color="${C.wine}"/>
      <stop offset="${round(horizon)}" stop-color="${C.terracotta}"/>
      <stop offset="1" stop-color="${C.night}"/>
    </linearGradient>
    <radialGradient id="glow-${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.amber}" stop-opacity="0.75"/>
      <stop offset="1" stop-color="${C.amber}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fade-${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.night}" stop-opacity="0.88"/>
      <stop offset="0.42" stop-color="${C.night}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${C.night}" stop-opacity="0.05"/>
    </linearGradient>
    <filter id="grain-${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.16"/></feComponentTransfer>
    </filter>
    <filter id="soft-${id}"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="soft2-${id}"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>`;

const wrap = (id, body, horizon) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  ${defs(id, horizon)}
  <rect width="${W}" height="${H}" fill="url(#sky-${id})"/>
  ${body}
  <rect width="${W}" height="${H}" fill="url(#fade-${id})"/>
  <rect width="${W}" height="${H}" filter="url(#grain-${id})" opacity="0.5"/>
  <rect width="${W}" height="${H}" fill="none"/>
  <radialGradient id="vig-${id}" cx="0.5" cy="0.5" r="0.75">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.62"/>
  </radialGradient>
  <rect width="${W}" height="${H}" fill="url(#vig-${id})"/>
</svg>`;

const stringLights = (fromX, toX, y, sag, count) => {
  let out = `<path d="M${fromX} ${y} Q ${(fromX + toX) / 2} ${y + sag} ${toX} ${y}" stroke="${C.night}" stroke-width="4" fill="none"/>`;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = fromX + (toX - fromX) * t;
    const yy = y + sag * 2 * t * (1 - t) + 14;
    const tone = i % 3 === 0 ? C.amber : i % 3 === 1 ? C.terracotta : C.amberPale;
    out += `<circle cx="${round(x)}" cy="${round(yy)}" r="7" fill="${tone}"/>
      <circle cx="${round(x)}" cy="${round(yy)}" r="17" fill="${tone}" opacity="0.28" filter="url(#soft-${id0})"/>`;
  }
  return out;
};

let id0 = 'x';

const scenes = {
  // ── Tea stall at dusk ────────────────────────────────────────────────────
  'tea-stall': () => {
    id0 = 'tea';
    return `
    <ellipse cx="1180" cy="470" rx="230" ry="150" fill="url(#glow-tea)"/>
    ${stringLights(880, 1560, 250, 60, 9)}
    <rect x="960" y="470" width="560" height="30" rx="6" fill="${C.night}"/>
    <rect x="985" y="330" width="24" height="145" fill="${C.night}"/>
    <rect x="1470" y="330" width="24" height="145" fill="${C.night}"/>
    <rect x="960" y="320" width="560" height="18" rx="6" fill="${C.smoke}"/>
    <path d="M1040 470 h120 v-52 a40 40 0 0 0-40-40 h-40 a40 40 0 0 0-40 40 z" fill="${C.smoke}"/>
    <path d="M1160 396 q46 6 34 44 q-8 26-44 20" fill="none" stroke="${C.smoke}" stroke-width="12"/>
    <path d="M1075 372 q16-34-6-62 M1115 372 q18-40-8-70" stroke="${C.ivory}" stroke-width="7" fill="none" opacity="0.35" filter="url(#soft-tea)"/>
    <circle cx="1330" cy="430" r="18" fill="${C.amber}"/>
    <circle cx="1420" cy="430" r="18" fill="${C.amber}"/>
    <path d="M1240 470 q40-120 96-120 q60 0 96 120 z" fill="${C.night}" opacity="0.9"/>
    <circle cx="1336" cy="330" r="34" fill="${C.night}" opacity="0.9"/>
    <path d="M0 700 h1600 v200 H0 z" fill="${C.night}"/>
    <path d="M0 700 q420-38 860-6 q360 26 740-14 v220 H0 z" fill="#070404"/>
    <rect x="140" y="560" width="360" height="22" rx="8" fill="${C.night}" opacity="0.85"/>
    <rect x="176" y="582" width="18" height="120" fill="${C.night}" opacity="0.85"/>
    <rect x="456" y="582" width="18" height="120" fill="${C.night}" opacity="0.85"/>
    <circle cx="270" cy="520" r="46" fill="${C.night}" opacity="0.85"/>
    <rect x="240" y="556" width="66" height="60" rx="18" fill="${C.night}" opacity="0.85"/>`;
  },

  // ── Highway at golden hour ───────────────────────────────────────────────
  'highway': () => {
    id0 = 'hw';
    return `
    <circle cx="1240" cy="430" r="86" fill="${C.amberPale}" opacity="0.9"/>
    <circle cx="1240" cy="430" r="170" fill="url(#glow-hw)"/>
    <path d="M0 520 L260 470 L520 512 L820 452 L1120 505 L1600 460 L1600 620 L0 620 Z" fill="${C.wineDeep}" opacity="0.75"/>
    <path d="M0 590 L340 545 L700 585 L1060 540 L1600 580 L1600 660 L0 660 Z" fill="${C.night}" opacity="0.85"/>
    <path d="M760 620 L1600 620 L1600 900 L180 900 Z" fill="#0E0705"/>
    <path d="M980 640 L1080 640 L1420 900 L1220 900 Z" fill="${C.amber}" opacity="0.22"/>
    <g fill="${C.amber}" opacity="0.8">
      <rect x="1140" y="690" width="150" height="16" rx="8"/>
      <rect x="1240" y="750" width="220" height="20" rx="10"/>
      <rect x="1330" y="830" width="300" height="26" rx="13"/>
    </g>
    <g fill="${C.night}">
      <rect x="620" y="300" width="14" height="330"/>
      <path d="M620 316 h150 l-24 40 h-126 z"/>
      <rect x="300" y="380" width="10" height="250"/>
      <path d="M300 392 h110 l-18 32 H300 z"/>
    </g>
    <g transform="translate(360 470)">
      <rect x="0" y="40" width="300" height="150" rx="14" fill="${C.night}"/>
      <rect x="212" y="76" width="82" height="66" rx="8" fill="${C.wine}"/>
      <rect x="18" y="70" width="150" height="70" rx="8" fill="${C.terracotta}" opacity="0.75"/>
      <circle cx="70" cy="196" r="34" fill="#0A0505"/>
      <circle cx="236" cy="196" r="34" fill="#0A0505"/>
      <circle cx="70" cy="196" r="12" fill="${C.smoke}"/>
      <circle cx="236" cy="196" r="12" fill="${C.smoke}"/>
      <rect x="300" y="150" width="26" height="20" rx="6" fill="${C.amber}"/>
    </g>
    <path d="M0 860 h1600 v40 H0 z" fill="#070404" opacity="0.7"/>`;
  },

  // ── Bus window / journey ─────────────────────────────────────────────────
  bus: () => {
    id0 = 'bus';
    return `
    <rect x="120" y="90" width="1360" height="720" rx="46" fill="#0A0505" opacity="0.55"/>
    <rect x="170" y="140" width="1260" height="620" rx="34" fill="url(#sky-bus)" opacity="0.95"/>
    <circle cx="1130" cy="330" r="70" fill="${C.amberPale}" opacity="0.85"/>
    <path d="M170 560 L470 500 L760 545 L1080 495 L1430 545 L1430 760 L170 760 Z" fill="${C.wineDeep}" opacity="0.8"/>
    <path d="M170 640 q300-40 620 0 q320 40 640-10 v130 H170 z" fill="${C.night}" opacity="0.92"/>
    <g fill="${C.night}" opacity="0.9">
      <rect x="470" y="380" width="10" height="180"/>
      <rect x="980" y="360" width="10" height="200"/>
      <path d="M470 392 h86 l-16 30 H470 z"/>
    </g>
    <path d="M560 760 L900 560 L1240 760 Z" fill="${C.amber}" opacity="0.18"/>
    <rect x="770" y="140" width="18" height="620" fill="#0A0505" opacity="0.85"/>
    <rect x="170" y="470" width="1260" height="16" fill="#0A0505" opacity="0.75"/>
    <g stroke="${C.ivory}" stroke-width="3" opacity="0.16">
      <path d="M250 170 l70 400 M420 170 l64 400 M640 170 l58 400 M1100 170 l64 400 M1300 170 l60 400"/>
    </g>
    <rect x="120" y="90" width="1360" height="720" rx="46" fill="none" stroke="#0A0505" stroke-width="26"/>
    <path d="M0 760 h1600 v140 H0 z" fill="#070404"/>
    <rect x="180" y="742" width="1240" height="26" rx="12" fill="${C.smoke}"/>`;
  },

  // ── Railway platform ─────────────────────────────────────────────────────
  railway: () => {
    id0 = 'rail';
    return `
    <rect width="${W}" height="${H}" fill="url(#sky-rail)"/>
    <circle cx="380" cy="300" r="60" fill="${C.amberPale}" opacity="0.7"/>
    <g fill="${C.night}">
      <rect x="0" y="640" width="1600" height="260"/>
      <rect x="120" y="120" width="26" height="520"/>
      <rect x="560" y="120" width="26" height="520"/>
      <rect x="1040" y="120" width="26" height="520"/>
      <rect x="1460" y="120" width="26" height="520"/>
      <path d="M60 150 h1480 v40 H60 z"/>
      <path d="M60 190 h1480 v16 H60 z" opacity="0.7"/>
    </g>
    <g transform="translate(760 330)">
      <rect x="0" y="0" width="720" height="300" rx="26" fill="${C.wineDeep}"/>
      <path d="M0 0 h720 v70 H0 z" fill="${C.terracotta}" opacity="0.55"/>
      <g fill="#0A0505" opacity="0.85">
        <rect x="60" y="96" width="110" height="96" rx="10"/>
        <rect x="210" y="96" width="110" height="96" rx="10"/>
        <rect x="360" y="96" width="110" height="96" rx="10"/>
        <rect x="510" y="96" width="110" height="96" rx="10"/>
      </g>
      <circle cx="676" cy="200" r="26" fill="${C.amber}"/>
      <circle cx="676" cy="200" r="60" fill="url(#glow-rail)"/>
      <rect x="0" y="286" width="720" height="24" fill="#0A0505"/>
    </g>
    <g fill="#0A0505">
      <rect x="0" y="700" width="1600" height="14"/>
      <rect x="0" y="760" width="1600" height="10" opacity="0.6"/>
    </g>
    <g stroke="${C.amber}" stroke-width="6" opacity="0.35">
      <path d="M0 706 h1600"/>
    </g>
    <g fill="${C.night}">
      <rect x="240" y="500" width="60" height="150" rx="14"/>
      <circle cx="270" cy="470" r="34"/>
      <rect x="360" y="520" width="54" height="130" rx="14"/>
      <circle cx="387" cy="494" r="30"/>
    </g>
    <circle cx="1330" cy="230" r="18" fill="${C.amber}"/>
    <circle cx="1330" cy="280" r="14" fill="${C.terracotta}"/>
    <rect x="1316" y="200" width="28" height="180" fill="${C.night}"/>`;
  },

  // ── Festival night ───────────────────────────────────────────────────────
  festival: () => {
    id0 = 'fest';
    return `
    <circle cx="820" cy="330" r="120" fill="url(#glow-fest)"/>
    ${stringLights(60, 780, 190, 70, 8)}
    ${stringLights(820, 1540, 210, 80, 8)}
    <g fill="${C.night}">
      <path d="M640 660 h360 v-40 q0-90-60-140 h-240 q-60 50-60 140 z"/>
      <rect x="700" y="660" width="240" height="40"/>
      <path d="M760 480 q60-140 120 0 z"/>
      <circle cx="820" cy="380" r="26"/>
      <rect x="812" y="330" width="16" height="46"/>
    </g>
    <path d="M0 700 h1600 v200 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <path d="M180 700 q40-160 90-160 q52 0 92 160 z" opacity="0.9"/>
      <circle cx="270" cy="512" r="38" opacity="0.9"/>
      <path d="M1180 700 q46-190 104-190 q60 0 106 190 z" opacity="0.9"/>
      <circle cx="1284" cy="478" r="42" opacity="0.9"/>
      <path d="M1420 700 q36-130 82-130 q46 0 82 130 z" opacity="0.8"/>
      <circle cx="1502" cy="542" r="32" opacity="0.8"/>
    </g>
    <g>
      ${[140, 330, 520, 1020, 1240, 1460]
        .map(
          (x) => `<path d="M${x} 700 q34-30 68 0 z" fill="${C.terracotta}"/>
            <ellipse cx="${x + 34}" cy="676" rx="34" ry="14" fill="${C.amber}" opacity="0.55" filter="url(#soft-fest)"/>
            <path d="M${x + 34} 664 q10-22 0-34 q-12 16 0 34" fill="${C.amberPale}"/>`,
        )
        .join('')}
    </g>
    <g fill="${C.amber}" opacity="0.5">
      <circle cx="480" cy="300" r="4"/><circle cx="560" cy="240" r="3"/>
      <circle cx="980" cy="270" r="4"/><circle cx="1060" cy="330" r="3"/>
      <circle cx="420" cy="420" r="3"/><circle cx="1120" cy="410" r="4"/>
    </g>`;
  },

  // ── Workshop / builders ──────────────────────────────────────────────────
  workshop: () => {
    id0 = 'work';
    return `
    <rect width="${W}" height="${H}" fill="#150B09"/>
    <ellipse cx="820" cy="250" rx="300" ry="220" fill="url(#glow-work)"/>
    <rect x="0" y="640" width="1600" height="260" fill="#0A0605"/>
    <path d="M0 640 h1600 v20 H0 z" fill="${C.smoke}"/>
    <g fill="${C.night}">
      <rect x="795" y="0" width="10" height="150"/>
      <path d="M745 150 h110 l-24 60 h-62 z"/>
    </g>
    <circle cx="800" cy="220" r="40" fill="${C.amber}" opacity="0.95"/>
    <circle cx="800" cy="220" r="120" fill="url(#glow-work)" opacity="0.7"/>
    <g fill="${C.night}">
      <rect x="200" y="470" width="520" height="26" rx="8"/>
      <rect x="230" y="496" width="26" height="150"/>
      <rect x="664" y="496" width="26" height="150"/>
      <rect x="300" y="404" width="40" height="70" rx="8"/>
      <path d="M340 404 h96 v18 h-96 z"/>
      <rect x="500" y="392" width="26" height="82" rx="8"/>
      <path d="M526 404 l70-26 12 24-72 26 z"/>
      <circle cx="620" cy="440" r="30"/>
      <path d="M604 470 l34 0 -10 40 -18 0 z"/>
    </g>
    <g transform="translate(1120 300)">
      <rect x="0" y="240" width="300" height="30" rx="8" fill="${C.night}"/>
      <rect x="30" y="270" width="24" height="130" fill="${C.night}"/>
      <rect x="240" y="270" width="24" height="130" fill="${C.night}"/>
      <path d="M40 240 q40-140 110-140 q70 0 110 140 z" fill="${C.night}"/>
      <circle cx="150" cy="76" r="44" fill="${C.night}"/>
      <rect x="112" y="24" width="76" height="22" rx="10" fill="${C.smoke}"/>
    </g>
    <g fill="${C.amber}">
      <circle cx="1020" cy="560" r="5"/><circle cx="1060" cy="600" r="4"/>
      <circle cx="990" cy="620" r="3"/><circle cx="1090" cy="540" r="3"/>
      <circle cx="1040" cy="500" r="4"/>
    </g>
    <rect x="0" y="0" width="1600" height="140" fill="#0A0605" opacity="0.7"/>
    <rect x="120" y="60" width="360" height="70" rx="10" fill="${C.smoke}"/>
    <rect x="150" y="86" width="300" height="10" rx="5" fill="${C.terracotta}" opacity="0.7"/>`;
  },

  // ── Bazaar / market ──────────────────────────────────────────────────────
  market: () => {
    id0 = 'mkt';
    return `
    ${stringLights(80, 1520, 150, 60, 14)}
    <g>
      <rect x="80" y="300" width="360" height="380" fill="${C.wineDeep}"/>
      <path d="M60 300 h400 l-40 70 H100 z" fill="${C.terracotta}" opacity="0.85"/>
      <rect x="500" y="250" width="420" height="430" fill="#160C0B"/>
      <path d="M480 250 h460 l-46 74 H526 z" fill="${C.amber}" opacity="0.55"/>
      <rect x="980" y="320" width="380" height="360" fill="${C.wineDeep}"/>
      <path d="M960 320 h420 l-40 66 H1000 z" fill="${C.terracotta}" opacity="0.7"/>
      <rect x="1420" y="280" width="200" height="400" fill="#160C0B"/>
    </g>
    <g fill="#0A0605" opacity="0.9">
      <rect x="150" y="420" width="220" height="260" rx="6"/>
      <rect x="570" y="380" width="280" height="300" rx="6"/>
      <rect x="1050" y="440" width="240" height="240" rx="6"/>
    </g>
    <g fill="${C.amber}" opacity="0.65">
      <rect x="590" y="400" width="240" height="16" rx="8"/>
      <rect x="170" y="440" width="180" height="14" rx="7"/>
    </g>
    <g>
      <rect x="600" y="500" width="70" height="60" rx="10" fill="${C.terracotta}" opacity="0.75"/>
      <rect x="690" y="510" width="70" height="50" rx="10" fill="${C.amber}" opacity="0.5"/>
      <rect x="780" y="496" width="60" height="64" rx="10" fill="${C.wine}" opacity="0.9"/>
    </g>
    <path d="M0 680 h1600 v220 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <path d="M300 680 q44-170 100-170 q58 0 102 170 z"/>
      <circle cx="400" cy="470" r="40"/>
      <path d="M880 680 q40-150 92-150 q54 0 94 150 z"/>
      <circle cx="972" cy="500" r="36"/>
      <path d="M1240 680 q36-130 82-130 q48 0 84 130 z"/>
      <circle cx="1322" cy="520" r="32"/>
    </g>
    <g fill="${C.amber}" opacity="0.35">
      <ellipse cx="700" cy="760" rx="180" ry="26"/>
      <ellipse cx="1240" cy="810" rx="150" ry="22"/>
    </g>`;
  },

  // ── Rainy street ─────────────────────────────────────────────────────────
  'rainy-street': () => {
    id0 = 'rain';
    return `
    <ellipse cx="1180" cy="360" rx="260" ry="200" fill="url(#glow-rain)"/>
    <g fill="${C.wineDeep}" opacity="0.85">
      <rect x="60" y="200" width="300" height="460"/>
      <rect x="420" y="150" width="260" height="510"/>
      <rect x="740" y="230" width="300" height="430"/>
      <rect x="1100" y="140" width="440" height="520"/>
    </g>
    <g fill="${C.amber}" opacity="0.5">
      ${[110, 200, 470, 560, 790, 880, 1160, 1270, 1400]
        .map((x, i) => `<rect x="${x}" y="${260 + (i % 3) * 70}" width="44" height="58" rx="6"/>`)
        .join('')}
    </g>
    <path d="M0 660 h1600 v240 H0 z" fill="#0A0706"/>
    <path d="M0 660 h1600 v10 H0 z" fill="${C.terracotta}" opacity="0.5"/>
    <g fill="${C.night}">
      <path d="M480 660 q46-70 116-70 q72 0 118 70 z"/>
      <rect x="592" y="660" width="8" height="90"/>
      <path d="M980 660 q40-60 100-60 q62 0 102 60 z"/>
      <rect x="1078" y="660" width="8" height="80"/>
      <circle cx="596" cy="576" r="30"/>
      <circle cx="1082" cy="588" r="26"/>
    </g>
    <g stroke="${C.ivory}" stroke-width="2.5" opacity="0.22">
      ${Array.from({ length: 46 }, (_, i) => {
        const x = (i * 37) % W;
        const y = (i * 149) % 700;
        return `<path d="M${x} ${y} l-14 68"/>`;
      }).join('')}
    </g>
    <g opacity="0.35" filter="url(#soft-rain)">
      <ellipse cx="600" cy="740" rx="120" ry="20" fill="${C.amber}"/>
      <ellipse cx="1120" cy="790" rx="150" ry="24" fill="${C.terracotta}"/>
      <ellipse cx="300" cy="820" rx="100" ry="18" fill="${C.amberPale}"/>
    </g>`;
  },

  // ── Café / monsoon window ────────────────────────────────────────────────
  cafe: () => {
    id0 = 'cafe';
    return `
    <rect width="${W}" height="${H}" fill="#120A09"/>
    <rect x="520" y="90" width="960" height="640" rx="30" fill="url(#sky-cafe)" opacity="0.9"/>
    <circle cx="1180" cy="300" r="66" fill="${C.amberPale}" opacity="0.75"/>
    <path d="M520 560 q240-70 480-10 q220 56 480-20 v200 H520 z" fill="${C.night}" opacity="0.85"/>
    <g fill="${C.wineDeep}" opacity="0.9">
      <rect x="640" y="420" width="120" height="140" rx="8"/>
      <rect x="820" y="380" width="150" height="180" rx="8"/>
      <rect x="1240" y="410" width="140" height="150" rx="8"/>
    </g>
    <g stroke="#0A0605" stroke-width="22" fill="none">
      <rect x="520" y="90" width="960" height="640" rx="30"/>
      <path d="M1000 90 V730"/>
      <path d="M520 410 H1480"/>
    </g>
    <g stroke="${C.ivory}" stroke-width="3" opacity="0.18">
      ${Array.from({ length: 22 }, (_, i) => {
        const x = 560 + i * 42;
        return `<path d="M${x} 110 l-10 120"/>`;
      }).join('')}
    </g>
    <path d="M0 700 h1600 v200 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <rect x="140" y="560" width="330" height="24" rx="10"/>
      <rect x="180" y="584" width="22" height="130"/>
      <rect x="420" y="584" width="22" height="130"/>
      <path d="M240 560 q30-46 74-46 q46 0 74 46 z" opacity="0.9"/>
      <rect x="520" y="504" width="10" height="56"/>
      <ellipse cx="525" cy="498" rx="42" ry="14"/>
      <path d="M566 486 q22 4 16 26 q-6 16-24 12" fill="none" stroke="${C.night}" stroke-width="8"/>
      <path d="M540 462 q10-24-4-44 M576 462 q12-26-4-46" stroke="${C.ivory}" stroke-width="5" fill="none" opacity="0.3" filter="url(#soft-cafe)"/>
    </g>
    <circle cx="300" cy="360" r="16" fill="${C.amber}"/>
    <rect x="294" y="200" width="8" height="150" fill="${C.night}"/>
    <circle cx="300" cy="360" r="52" fill="url(#glow-cafe)" opacity="0.6"/>`;
  },

  // ── Rooftops / old neighbourhood ─────────────────────────────────────────
  neighborhood: () => {
    id0 = 'nbh';
    return `
    <circle cx="1280" cy="220" r="72" fill="${C.amberPale}" opacity="0.85"/>
    <circle cx="1280" cy="220" r="150" fill="url(#glow-nbh)" opacity="0.6"/>
    <g fill="${C.wineDeep}" opacity="0.9">
      <rect x="0" y="440" width="260" height="300"/>
      <rect x="300" y="380" width="200" height="360"/>
      <rect x="540" y="470" width="280" height="270"/>
      <rect x="860" y="400" width="220" height="340"/>
      <rect x="1120" y="480" width="240" height="260"/>
      <rect x="1400" y="420" width="200" height="320"/>
    </g>
    <g fill="#0A0605">
      <rect x="40" y="390" width="90" height="70" rx="8"/>
      <rect x="360" y="330" width="70" height="60" rx="8"/>
      <rect x="920" y="350" width="80" height="60" rx="8"/>
      <rect x="1450" y="370" width="70" height="60" rx="8"/>
      <path d="M120 390 h10 v-40 h-10 z M600 470 h10 v-50 h-10 z M1200 480 h10 v-46 h-10 z"/>
    </g>
    <g fill="${C.amber}" opacity="0.65">
      ${[30, 90, 150, 330, 390, 580, 650, 720, 890, 960, 1150, 1220, 1440, 1500]
        .map((x, i) => `<rect x="${x}" y="${480 + (i % 4) * 54}" width="34" height="44" rx="5"/>`)
        .join('')}
    </g>
    <g stroke="#0A0605" stroke-width="5" fill="none" opacity="0.85">
      <path d="M0 340 q400 70 800 0 q400-70 800 10"/>
      <path d="M0 386 q420 84 820 6 q380-74 780 6"/>
    </g>
    <path d="M0 740 h1600 v160 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <path d="M700 740 q44-150 100-150 q58 0 102 150 z"/>
      <circle cx="800" cy="560" r="38"/>
    </g>
    <g fill="${C.amber}" opacity="0.5">
      <circle cx="240" cy="300" r="4"/><circle cx="700" cy="250" r="3"/>
      <circle cx="1040" cy="300" r="4"/><circle cx="500" cy="220" r="3"/>
    </g>`;
  },

  // ── Desert / folk ────────────────────────────────────────────────────────
  desert: () => {
    id0 = 'dst';
    return `
    <circle cx="1120" cy="330" r="94" fill="${C.amberPale}" opacity="0.9"/>
    <circle cx="1120" cy="330" r="200" fill="url(#glow-dst)"/>
    <path d="M0 520 q300-70 620 0 q340 76 980-24 v404 H0 z" fill="${C.wineDeep}" opacity="0.85"/>
    <path d="M0 640 q360-60 760 10 q380 66 840-30 v280 H0 z" fill="${C.night}"/>
    <path d="M0 760 q420-50 820 20 q360 64 780-40 v160 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <path d="M300 640 q30-70 84-70 q56 0 86 70 l-14 6 q-16-40-72-40 q-54 0-70 40 z"/>
      <rect x="352" y="586" width="16" height="60"/>
      <path d="M430 640 l14-52 16 6 -10 46 z"/>
      <circle cx="376" cy="556" r="24"/>
      <path d="M376 580 q16 22 8 40 l-16 0 q4-20-6-38 z"/>
      <rect x="344" y="700" width="14" height="60"/>
      <rect x="430" y="700" width="14" height="60"/>
    </g>
    <g transform="translate(880 520)">
      <path d="M0 160 h320 v-24 q0-80-60-120 h-200 q-60 40-60 120 z" fill="${C.night}"/>
      <rect x="60" y="160" width="26" height="110"/>
      <rect x="230" y="160" width="26" height="110"/>
      <path d="M120 16 q40-70 80 0 z" fill="${C.terracotta}"/>
      <circle cx="160" cy="-24" r="16" fill="${C.night}"/>
      <rect x="154" y="-64" width="12" height="40"/>
    </g>
    <g fill="${C.amber}" opacity="0.35">
      <ellipse cx="1120" cy="800" rx="260" ry="30"/>
    </g>`;
  },

  // ── Night desk / study ───────────────────────────────────────────────────
  'night-desk': () => {
    id0 = 'night';
    return `
    <rect width="${W}" height="${H}" fill="#0E0807"/>
    <rect x="700" y="80" width="820" height="560" rx="26" fill="url(#sky-night)" opacity="0.85"/>
    <g fill="${C.wineDeep}" opacity="0.9">
      <rect x="760" y="300" width="120" height="340"/>
      <rect x="920" y="240" width="150" height="400"/>
      <rect x="1120" y="330" width="120" height="310"/>
      <rect x="1280" y="270" width="180" height="370"/>
    </g>
    <g fill="${C.amber}" opacity="0.6">
      ${Array.from({ length: 26 }, (_, i) => {
        const x = 780 + ((i * 61) % 660);
        const y = 330 + ((i * 97) % 260);
        return `<rect x="${x}" y="${y}" width="16" height="22" rx="3"/>`;
      }).join('')}
    </g>
    <g stroke="#0A0605" stroke-width="20" fill="none">
      <rect x="700" y="80" width="820" height="560" rx="26"/>
      <path d="M1110 80 V640"/>
    </g>
    <path d="M0 640 h1600 v260 H0 z" fill="#070404"/>
    <g fill="${C.night}">
      <rect x="120" y="560" width="520" height="26" rx="10"/>
      <rect x="150" y="586" width="24" height="180"/>
      <rect x="586" y="586" width="24" height="180"/>
      <rect x="240" y="440" width="300" height="130" rx="10"/>
      <rect x="266" y="462" width="248" height="86" rx="6" fill="${C.amber}" opacity="0.45"/>
      <rect x="360" y="570" width="60" height="12"/>
      <path d="M540 560 q26-70 74-70 q50 0 76 70 z" opacity="0.95"/>
      <rect x="606" y="486" width="10" height="76"/>
      <path d="M586 470 h50 l-14-46 h-24 z" fill="${C.terracotta}"/>
      <circle cx="611" cy="440" r="26" fill="${C.amber}" opacity="0.85"/>
      <circle cx="611" cy="440" r="86" fill="url(#glow-night)" opacity="0.7"/>
    </g>
    <g fill="${C.ivory}" opacity="0.22">
      <rect x="160" y="600" width="120" height="8" rx="4"/>
      <rect x="420" y="612" width="90" height="8" rx="4"/>
    </g>`;
  },
};

const ART = {
  'tea-stall': { file: 'tea-stall', alt: 'Illustration' },
  highway: { file: 'highway', alt: 'Illustration' },
  bus: { file: 'bus', alt: 'Illustration' },
  railway: { file: 'railway', alt: 'Illustration' },
  festival: { file: 'festival', alt: 'Illustration' },
  workshop: { file: 'workshop', alt: 'Illustration' },
  market: { file: 'market', alt: 'Illustration' },
  'rainy-street': { file: 'rainy-street', alt: 'Illustration' },
  cafe: { file: 'cafe', alt: 'Illustration' },
  neighborhood: { file: 'neighborhood', alt: 'Illustration' },
  desert: { file: 'desert', alt: 'Illustration' },
  'night-desk': { file: 'night-desk', alt: 'Illustration' },
};

fs.mkdirSync(OUT, { recursive: true });

for (const [name, build] of Object.entries(scenes)) {
  const file = path.join(OUT, `${name}.svg`);
  // `build()` sets the inner gradient/filter prefix used in its markup.
  const body = build();
  fs.writeFileSync(file, wrap(id0, body, 0.62), 'utf8');
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  wrote art/${name}.svg (${kb} kB)`);
}

console.log(`  ${Object.keys(scenes).length} scenes written to public/art/`);
