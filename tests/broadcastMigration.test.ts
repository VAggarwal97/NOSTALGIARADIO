import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Migration 9 opens the broadcast clock to anonymous listeners — which is only
 * safe because the surface is a handful of definer functions with an explicit
 * grant list. These assertions are the fence: if a later migration widens the
 * hole (table writes, helper RPCs, a missing search_path), this suite fails
 * before the change can ship.
 */

const SQL = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261002000009_broadcasts.sql'),
  'utf8',
);

/** Every `create or replace function <name>` in the migration. */
const functions = [...SQL.matchAll(/create or replace function\s+public\.(\w+)/gi)].map(
  (m) => m[1],
);

const bodyOf = (name: string): string => {
  const start = SQL.search(new RegExp(`create or replace function\\s+public\\.${name}\\b`, 'i'));
  expect(start, `function ${name} exists in migration 9`).toBeGreaterThanOrEqual(0);
  const rest = SQL.slice(start);
  const end = rest.search(/\ncreate or replace function|\nrevoke\b|\ngrant\b/i);
  return end === -1 ? rest : rest.slice(0, end);
};

describe('broadcast functions', () => {
  it('defines exactly the five expected functions', () => {
    expect([...functions].sort()).toEqual([
      'advance_broadcast',
      'broadcast_next_track',
      'broadcast_state',
      'broadcast_suggestion_matches',
      'report_broadcast_duration',
    ]);
  });

  it('runs every function as definer with a pinned search_path', () => {
    for (const name of functions) {
      const body = bodyOf(name);
      expect(body, `${name} is SECURITY DEFINER`).toMatch(/security\s+definer/i);
      expect(body, `${name} pins search_path`).toMatch(
        /set\s+search_path\s*=\s*public,\s*pg_temp/i,
      );
    }
  });

  it('advance is a compare-and-swap on the caller’s observed started_at', () => {
    const body = bodyOf('advance_broadcast');
    expect(body).toMatch(/for\s+update\s*;/i);
    expect(body).toMatch(/started_at\s*=\s*p_expected_started_at/i);
    expect(body).toMatch(/where\s+category_slug\s*=\s*p_category/i);
  });

  it('duration reports are clamped server-side — a client cannot pin any length', () => {
    const body = bodyOf('report_broadcast_duration');
    expect(body).toMatch(/p_duration_sec\s+<\s*10\s+or\s+p_duration_sec\s+>\s*900/i);
    expect(body).toMatch(/and\s+track_kind\s*=\s*'suggestion'/i);
    expect(body).toMatch(/and\s+duration_sec\s+is\s+null/i);
    expect(body).toMatch(/started_at\s*=\s*p_expected_started_at/i);
  });
});

describe('the anon surface', () => {
  it('never writes broadcasts from the table directly', () => {
    expect(SQL).not.toMatch(
      /grant\s+(insert|update|delete|truncate|references)\s+on\s+public\.broadcasts/i,
    );
    expect(SQL).toMatch(
      /revoke\s+insert,\s*update,\s*delete,\s*truncate\s+on\s+public\.broadcasts\s+from\s+anon/i,
    );
  });

  it('revokes the three entry points from the default PUBLIC grant', () => {
    for (const signature of [
      'public.broadcast_state(text)',
      'public.advance_broadcast(text, timestamptz)',
      'public.report_broadcast_duration(text, timestamptz, integer)',
    ]) {
      expect(
        SQL,
        `${signature} revoked from public, anon, authenticated`,
      ).toMatch(new RegExp(`revoke execute on function ${signature.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`, 'i'));
    }
  });

  it('grants execute to anon on exactly the three safe entry points', () => {
    const grants = [
      ...SQL.matchAll(/grant execute on function ([^;]+?) to ([^;]+);/gis),
    ].map((m) => ({
      signature: m[1].replace(/\s+/g, ' ').trim(),
      to: m[2].split(',').map((role) => role.trim()),
    }));
    const toAnon = grants.filter((g) => g.to.includes('anon')).map((g) => g.signature);
    expect([...toAnon].sort()).toEqual(
      [
        'public.advance_broadcast(text, timestamptz)',
        'public.broadcast_state(text)',
        'public.report_broadcast_duration(text, timestamptz, integer)',
      ].sort(),
    );
    // The two helpers stay internal: no anon grant at all.
    for (const helper of ['broadcast_next_track', 'broadcast_suggestion_matches']) {
      expect(toAnon.join(' '), `no anon grant for ${helper}`).not.toContain(helper);
    }
  });

  it('enables RLS with a select-only policy', () => {
    expect(SQL).toMatch(/alter table\s+public\.broadcasts\s+enable row level security/i);
    expect(SQL).toMatch(/create policy broadcasts_open_read on public\.broadcasts/i);
    expect(SQL).toMatch(/for\s+select\s+to\s+anon,\s*authenticated\s+using\s*\(true\)/i);
  });

  it('publishes only the broadcasts table to realtime (guarded, idempotent)', () => {
    expect(SQL).toMatch(/pg_publication_tables/);
    expect(SQL).toMatch(/alter publication supabase_realtime add table public\.broadcasts/i);
  });

  it('publishes server_now with every snapshot (the clock never comes from the client)', () => {
    const body = bodyOf('broadcast_state');
    expect(body).toMatch(/'server_now',\s*v_now/i);
    expect(body).toMatch(/'upcoming',\s*v_upcoming/i);
  });

  it('attaches the live vote count when a community request is on air', () => {
    const body = bodyOf('broadcast_state');
    expect(body).toMatch(/if\s+v_row\.track_kind\s*=\s*'suggestion'\s+then/i);
    expect(body).toMatch(/suggestion_vote_counts/i);
    expect(body).toMatch(/v\.suggestion_id::text\s*=\s*v_row\.track_key/i);
  });
});
