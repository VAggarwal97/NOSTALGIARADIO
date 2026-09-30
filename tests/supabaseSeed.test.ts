import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { CATEGORIES } from '../src/data/categories';
import { STATIONS } from '../src/data/stations';

/**
 * The Supabase foundation is guarded here:
 *
 *  1. The committed catalogue seed must equal what `npm run seed:sql` emits
 *     from src/data/* (edit the TypeScript, regenerate, commit both).
 *  2. The migrations must keep their security invariants — RLS everywhere,
 *     no public UPDATE/DELETE, no visitor token on the wire, database-side
 *     rate limits, no secrets.
 *
 * The seed is produced by spawning the real CLI into a temp file, so the test
 * exercises exactly the command developers run (and never touches the
 * committed file).
 */

const scriptPath = fileURLToPath(new URL('../scripts/emit-supabase-seed.mjs', import.meta.url));
const seedPath = fileURLToPath(
  new URL('../supabase/migrations/20260930000003_seed_catalogue.sql', import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL('../supabase/migrations/20260930000001_foundation_schema.sql', import.meta.url),
);
const rlsPath = fileURLToPath(
  new URL('../supabase/migrations/20260930000002_rls_policies.sql', import.meta.url),
);

const normalize = (sql: string): string => sql.replace(/\r\n/g, '\n');

let generated = '';

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'nostalgia-seed-'));
  const out = join(dir, 'seed.sql');
  try {
    execFileSync(process.execPath, [scriptPath], {
      env: { ...process.env, SEED_OUT: out },
      stdio: 'pipe',
    });
    generated = normalize(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('supabase catalogue seed', () => {
  it('committed SQL matches the TypeScript catalogue (re-run npm run seed:sql)', () => {
    const committed = normalize(readFileSync(seedPath, 'utf8'));
    expect(committed).toBe(generated);
  });

  it('seeds every category and station by slug', () => {
    for (const category of CATEGORIES) {
      expect(generated).toContain(`('${category.id}'`);
    }
    for (const station of STATIONS) {
      expect(generated).toContain(`select '${station.id}', c.id`);
    }
    // Header must state the real counts.
    expect(generated).toContain(`-- ${CATEGORIES.length} categories · ${STATIONS.length} stations.`);
  });

  it('never stores a vote count anywhere in the catalogue', () => {
    expect(generated).not.toMatch(/\bvotes\s*=/);
  });
});

describe('supabase migration security invariants', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const rls = readFileSync(rlsPath, 'utf8');

  it('enables row level security on every exposed table', () => {
    for (const table of ['categories', 'stations', 'songs', 'suggestions', 'votes', 'station_events']) {
      expect(rls).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security;`));
    }
  });

  it('grants the public no UPDATE or DELETE path anywhere', () => {
    expect(rls).not.toMatch(/for\s+update/i);
    expect(rls).not.toMatch(/for\s+delete/i);
    expect(rls).not.toMatch(/grant\s+(insert|update|delete)[^\n]*\bon\s+all\s+tables/i);
    // The blanket revoke must exist before any insert grant.
    expect(rls).toContain('revoke insert, update, delete, truncate on all tables in schema public');
  });

  it('keeps visitor tokens off the wire', () => {
    // No SELECT policy on votes, and an explicit revoke on the token tables.
    expect(rls).not.toMatch(/policy[^\n]*on\s+public\.votes[\s\S]{0,160}for\s+select/i);
    expect(rls).toContain('revoke select on public.votes, public.station_events, public.suggestions');
    // The column grant the wall receives must not include the token column.
    const grantMatch = rls.match(/grant select \(([^)]*)\) on public\.suggestions/);
    expect(grantMatch).not.toBeNull();
    expect(grantMatch?.[1]).not.toContain('visitor_token');
  });

  it('enforces the V1 rate limits and duplicate identity in the database', () => {
    expect(schema).toContain('at most 3 suggestions per minute');
    expect(schema).toContain('at most 10 votes per minute');
    expect(schema).toContain('unique index if not exists suggestions_one_per_song');
    expect(schema).toContain('votes_one_per_suggestion');
  });

  it('contains no secrets and no audio bytes', () => {
    expect(schema + rls).not.toMatch(/service_role/i);
    expect(schema + rls).not.toMatch(/SUPABASE_SERVICE/i);
    expect(schema).not.toMatch(/\.(mp3|m4a|wav|flac)\b/i);
  });
});
