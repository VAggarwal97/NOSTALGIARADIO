/**
 * Content validation gate.
 *
 * Fails the build on structural or safety problems in src/data/*.ts:
 *   • duplicate or malformed station IDs
 *   • unknown category IDs
 *   • unsafe URL protocols (javascript:, data:, blob:, …)
 *   • missing required fields / missing audio for playable stations
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
  const seenIds = new Map();
  const nameCounts = new Map();

  for (const category of CATEGORIES ?? []) {
    if (!ID_PATTERN.test(String(category.id ?? ''))) fail(`Category id "${category.id}" is malformed.`);
    for (const field of ['label', 'shortLabel', 'tagline']) {
      if (!hasText(category[field])) fail(`Category "${category.id}" is missing "${field}".`);
      else if (EXECUTABLE.test(category[field])) fail(`Category "${category.id}" field "${field}" contains executable markup.`);
    }
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

    if (!categoryIds.has(station.category)) fail(`${at} uses unknown category "${station.category}".`);
    else if (station.category === 'mix') fail(`${at} must use a home category, not "mix".`);

    if (!isSafeUrl(station.url)) fail(`${at} has an unsafe or invalid url: ${String(station.url)}`);
    else if (isPlaceholder(station.url)) warn(`${at} still uses a placeholder source URL.`);

    if (station.action === 'play') {
      if (!isSafeUrl(station.audioUrl)) fail(`${at} is marked "play" without a safe audioUrl.`);
      if (station.sourceType !== 'direct-audio') warn(`${at} plays audio but sourceType is "${station.sourceType}".`);
    }

    if (!['play', 'check'].includes(station.action)) fail(`${at} has invalid action "${station.action}".`);
    if (!['external-site', 'direct-audio', 'embed'].includes(station.sourceType)) {
      fail(`${at} has invalid sourceType "${station.sourceType}".`);
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
