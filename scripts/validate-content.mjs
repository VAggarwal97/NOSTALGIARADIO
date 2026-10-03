/**
 * Content validation gate.
 *
 * Fails the build on structural or safety problems in src/data/*.ts:
 *   • duplicate or malformed station IDs
 *   • unknown category IDs
 *   • unsafe URL protocols (javascript:, data:, blob:, …)
 *   • missing required fields / missing audio for playable stations
 *   • provider/playlistUrl pairs that don't match a real playlist page shape
 *   • executable HTML/script payloads in any text field
 *
 * Warns (never fails) on duplicate display names, missing optional metadata and
 * placeholder source hosts — the supplied inventory legitimately repeats names,
 * and third-party availability must not gate a deploy.
 *
 * Usage: node scripts/validate-content.mjs [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'nostalgia-validate');
const STRICT = process.argv.includes('--strict');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED = new Set(['javascript:', 'data:', 'blob:', 'vbscript:', 'file:', 'about:']);
const SAFE_RELATIVE = /^\/(?!\/)/;
const EXECUTABLE = /<\s*script|<\s*iframe|javascript:|on\w+\s*=|data:text\/html/i;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

// ── Transpile the TypeScript data modules so this runs with plain Node ──────
async function loadDataModule(file) {
  const { default: ts } = await import('typescript');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: file,
  }).outputText;

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `${path.basename(file, '.ts')}.mjs`);
  fs.writeFileSync(outFile, output, 'utf8');
  return import(`${url.pathToFileURL(outFile).href}?v=${Date.now()}`);
}

const isSafeUrl = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const value = raw.trim();
  if (SAFE_RELATIVE.test(value)) return true;
  try {
    const parsed = new URL(value);
    if (BLOCKED.has(parsed.protocol.toLowerCase())) return false;
    return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase()) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const isPlaceholder = (raw) => {
  try {
    const host = new URL(raw).hostname;
    return host === 'example.org' || host === 'example.com' || host.endsWith('.example');
  } catch {
    return false;
  }
};

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

async function main() {
  const { STATIONS } = await loadDataModule(path.join(DATA_DIR, 'stations.ts'));
  const { CATEGORIES } = await loadDataModule(path.join(DATA_DIR, 'categories.ts'));

  if (!Array.isArray(STATIONS) || STATIONS.length === 0) fail('stations.ts exports no stations.');
  if (!Array.isArray(CATEGORIES) || CATEGORIES.length === 0) fail('categories.ts exports no categories.');

  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const stationsById = new Map((STATIONS ?? []).map((s) => [s.id, s]));
  const mixFlagshipId = CATEGORIES.find((c) => c.id === 'mix')?.flagship;
  const seenIds = new Map();
  const nameCounts = new Map();

  for (const category of CATEGORIES ?? []) {
    if (!ID_PATTERN.test(String(category.id ?? ''))) fail(`Category id "${category.id}" is malformed.`);
    for (const field of ['label', 'shortLabel', 'tagline']) {
      if (!hasText(category[field])) fail(`Category "${category.id}" is missing "${field}".`);
      else if (EXECUTABLE.test(category[field])) fail(`Category "${category.id}" field "${field}" contains executable markup.`);
    }
    if (!/^#[0-9a-f]{6}$/i.test(String(category.accent ?? ''))) {
      fail(`Category "${category.id}" accent must be a 6-digit hex colour, got "${category.accent}".`);
    }

    // Every chip must have an identity to switch the hero to.
    const flagship = stationsById.get(category.flagship);
    if (!flagship) {
      fail(`Category "${category.id}" flagship "${category.flagship}" does not exist.`);
      continue;
    }
    if (flagship.flagship !== true) fail(`Station "${flagship.id}" is the "${category.id}" flagship but is not marked \`flagship: true\`.`);
    if (flagship.category !== category.id) {
      fail(`Station "${flagship.id}" is the "${category.id}" flagship but its home category is "${flagship.category}".`);
    }
    if (!Array.isArray(flagship.titleLines) || flagship.titleLines.length !== 2 || flagship.titleLines.some((line) => !hasText(line))) {
      fail(`Station "${flagship.id}" is a flagship and needs \`titleLines: [line1, line2]\`.`);
    }
    if (!hasText(flagship.description)) fail(`Station "${flagship.id}" is a flagship and needs a description.`);
  }

  for (const station of STATIONS ?? []) {
    const label = station?.name ?? '<unnamed>';
    const at = `station "${label}"`;

    if (!hasText(station.id)) fail(`${at} has no id.`);
    else {
      if (!ID_PATTERN.test(station.id)) fail(`${at} id "${station.id}" must be lowercase kebab-case.`);
      if (seenIds.has(station.id)) fail(`Duplicate station id "${station.id}" (${seenIds.get(station.id)} and ${label}).`);
      seenIds.set(station.id, label);
    }

    nameCounts.set(station.name, (nameCounts.get(station.name) ?? 0) + 1);

    for (const field of ['name', 'description', 'url', 'artwork']) {
      if (!hasText(station[field])) fail(`${at} is missing required field "${field}".`);
      else if (EXECUTABLE.test(station[field])) fail(`${at} field "${field}" contains executable markup.`);
    }

    if (hasText(station.artwork)) {
      if (!/^\/art\/[a-z0-9-]+\.svg$/.test(station.artwork)) {
        fail(`${at} artwork must be a local /art/*.svg path, got "${station.artwork}".`);
      } else {
        const artworkFile = path.join(ROOT, 'public', station.artwork.replace(/^\//, ''));
        if (!fs.existsSync(artworkFile)) fail(`${at} artwork file is missing: ${station.artwork}`);
      }
    }

    // Hero-stage alternatives: real image URLs only, never markup. Local
    // /img paths (self-hosted, no third-party hotlink) or https URLs.
    if (station.backdrops !== undefined) {
      if (!Array.isArray(station.backdrops) || station.backdrops.length === 0 || station.backdrops.length > 12) {
        fail(`${at} backdrops must be an array of 1–12 URLs.`);
      } else {
        for (const [index, src] of station.backdrops.entries()) {
          const isLocal = typeof src === 'string' && /^\/[^\s'"`<>]+$/i.test(src);
          const isHttps = typeof src === 'string' && /^https:\/\/[^\s'"`<>]+$/i.test(src);
          if (!isLocal && !isHttps) {
            fail(`${at} backdrop #${index + 1} must be an https URL or a local /path, got "${String(src)}".`);
          } else if (EXECUTABLE.test(src)) {
            fail(`${at} backdrop #${index + 1} contains executable markup.`);
          } else if (isLocal) {
            const backdropFile = path.join(ROOT, 'public', src.replace(/^\//, ''));
            if (!fs.existsSync(backdropFile)) fail(`${at} backdrop file is missing: ${src}`);
          }
        }
      }
    }

    if (!categoryIds.has(station.category)) fail(`${at} uses unknown category "${station.category}".`);
    else if (station.category === 'mix' && station.id !== mixFlagshipId) {
      fail(`${at} must use a home category; only the MIX flagship may use "mix".`);
    }

    if (station.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(String(station.accent))) {
      fail(`${at} accent must be a 6-digit hex colour, got "${station.accent}".`);
    }

    if (!isSafeUrl(station.url)) fail(`${at} has an unsafe or invalid url: ${String(station.url)}`);
    else if (isPlaceholder(station.url)) warn(`${at} still uses a placeholder source URL.`);

    if (station.action === 'play') {
      if (!isSafeUrl(station.audioUrl)) fail(`${at} is marked "play" without a safe audioUrl.`);
      // A provider station's live source is the embed; local audio is only the
      // fallback — the pair below owns sourceType once provider + playlist exist.
      if (station.sourceType !== 'direct-audio' && !station.provider) {
        warn(`${at} plays audio but sourceType is "${station.sourceType}".`);
      }
    }

    if (!['play', 'check', 'request'].includes(station.action)) {
      fail(`${at} has invalid action "${station.action}".`);
    }
    if (!['external-site', 'direct-audio', 'embed'].includes(station.sourceType)) {
      fail(`${at} has invalid sourceType "${station.sourceType}".`);
    }

    // Provider playlist config: both fields or neither, and the URL must be a
    // playlist page on that exact provider (mirrors src/lib/sourcePolicy.ts).
    const hasProvider = station.provider !== undefined;
    const hasPlaylist = hasText(station.playlistUrl);
    const looksPlaceholderId = (value) => /(your|placeholder|xxxx|dummy)/i.test(value);
    if (hasProvider && !['youtube', 'spotify'].includes(station.provider)) {
      fail(`${at} has invalid provider "${station.provider}".`);
    } else if (hasProvider && !hasPlaylist) {
      fail(`${at} sets provider "${station.provider}" without a playlistUrl.`);
    } else if (hasPlaylist && !hasProvider) {
      fail(`${at} has a playlistUrl but no provider.`);
    } else if (hasProvider && hasPlaylist) {
      if (station.sourceType !== 'embed') {
        warn(`${at} plays through a provider but sourceType is "${station.sourceType}" — use "embed".`);
      }
      if (!isSafeUrl(station.playlistUrl)) {
        fail(`${at} playlistUrl is unsafe or invalid: ${station.playlistUrl}`);
      } else {
        try {
          const parsed = new URL(station.playlistUrl);
          const host = parsed.hostname.toLowerCase();
          if (station.provider === 'youtube') {
            const okHost = ['www.youtube.com', 'youtube.com', 'music.youtube.com'].includes(host);
            const list = parsed.searchParams.get('list');
            if (!okHost || parsed.pathname !== '/playlist' || !list || !/^[A-Za-z0-9_-]{6,}$/.test(list)) {
              fail(`${at} playlistUrl must be a YouTube playlist page (youtube.com/playlist?list=…), got "${station.playlistUrl}".`);
            } else if (looksPlaceholderId(list)) {
              warn(`${at} playlistId "${list}" still looks like a placeholder — the station stays on its source page until it's replaced.`);
            }
          } else if (station.provider === 'spotify') {
            const match = parsed.pathname.match(/^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{10,})\/?$/);
            if (host !== 'open.spotify.com' || !/playlist\//.test(parsed.pathname)) {
              fail(`${at} playlistUrl must be a Spotify playlist page (open.spotify.com/playlist/…), got "${station.playlistUrl}".`);
            } else if (looksPlaceholderId(parsed.pathname)) {
              warn(`${at} playlistId still looks like a placeholder — the station stays on its source page until it's replaced.`);
            } else if (!match) {
              fail(`${at} playlistUrl must end in a Spotify playlist ID (open.spotify.com/playlist/…), got "${station.playlistUrl}".`);
            }
          }
        } catch {
          fail(`${at} playlistUrl could not be parsed: ${station.playlistUrl}`);
        }
      }
    }

    for (const field of ['region', 'era']) {
      if (station[field] !== undefined && EXECUTABLE.test(String(station[field]))) {
        fail(`${at} field "${field}" contains executable markup.`);
      }
    }
    for (const value of [...(station.tags ?? []), ...(station.language ?? [])]) {
      if (EXECUTABLE.test(String(value))) fail(`${at} contains executable markup in metadata.`);
    }

    if (!hasText(station.region)) warn(`${at} is missing region.`);
    if (!hasText(station.era)) warn(`${at} is missing era.`);
    if (!Array.isArray(station.tags) || station.tags.length === 0) warn(`${at} has no tags.`);
    if (station.status === 'offline' && station.action === 'play') {
      warn(`${station.id} is flagged offline but is playable — the UI will show "Check Station".`);
    }
  }

  for (const [name, count] of nameCounts) {
    if (count > 1) warn(`Duplicate display name "${name}" appears ${count} times (allowed; IDs are unique).`);
  }

  // The donate slot must never ship a dead "#" or an unsafe URL. An empty
  // href is an intentional "not configured yet" state: the navbar renders the
  // slot disabled and site_settings.donation_url enables it at runtime.
  try {
    const { DONATE_LINK } = await loadDataModule(path.join(DATA_DIR, 'donate.ts'));
    if (!DONATE_LINK || typeof DONATE_LINK.label !== 'string' || !DONATE_LINK.label.trim()) {
      fail('donate.ts DONATE_LINK.label must have text.');
    }
    const href = DONATE_LINK?.href;
    if (typeof href !== 'string') {
      fail('donate.ts DONATE_LINK.href must be a string ("" = not configured).');
    } else if (href === '#') {
      fail('donate.ts DONATE_LINK.href is the dead "#" placeholder — use "" and set donation_url in /admin → Settings.');
    } else if (href.trim() && !isSafeUrl(href)) {
      fail(`donate.ts DONATE_LINK.href is unsafe or invalid: ${href}`);
    }
  } catch (error) {
    fail(`donate.ts could not be validated: ${error.message}`);
  }

  for (const message of warnings) console.warn(`  warn  ${message}`);
  for (const message of errors) console.error(`  error ${message}`);

  const total = STATIONS?.length ?? 0;
  console.log(
    `\n  ${total} stations · ${CATEGORIES?.length ?? 0} categories · ${errors.length} error(s) · ${warnings.length} warning(s)`,
  );

  const shouldFail = errors.length > 0 || (STRICT && warnings.length > 0);
  if (shouldFail) {
    console.error(STRICT && errors.length === 0 ? '  strict mode: warnings treated as errors.' : '  content validation failed.');
    process.exit(1);
  }
  console.log('  content validation passed.');
}

main().catch((error) => {
  console.error('  content validation crashed:', error);
  process.exit(1);
});
