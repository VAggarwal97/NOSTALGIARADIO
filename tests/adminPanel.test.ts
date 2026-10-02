import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { adminHref, routeFromPathname } from '../src/lib/routes';
import {
  MIGRATION_HINT,
  isMissingMigrationError,
  mapDbError,
} from '../src/admin/adminErrors';

/**
 * Admin panel invariants. The panel has NO login — no gate in the UI, no
 * authorization layer in SQL (migration 8 retires admin_users and is_admin())
 * — so what this file pins down is the set of guarantees that must survive
 * that openness:
 *
 *  1. visitor_token never reaches any SELECT grant, on any migration.
 *  2. The audit log stays trigger-written, JWT-scoped and secret-free.
 *  3. Migration 8 opens every managed table explicitly and documents its
 *     tradeoff instead of hiding it.
 *  4. The React side holds no passwords, no session storage, no service keys,
 *     and no sign-in remnants.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const migration4 = read('../supabase/migrations/20260930000004_admin_panel.sql');
const migration8 = read('../supabase/migrations/20261002000008_open_panel.sql');

const adminSources = [
  'AdminApp.tsx',
  'AdminShell.tsx',
  'supabaseClient.ts',
  'adminErrors.ts',
  'adminTypes.ts',
  'pageSupport.tsx',
  'pages/DashboardPage.tsx',
  'pages/SuggestionsPage.tsx',
  'pages/CataloguePage.tsx',
  'pages/SettingsPage.tsx',
  'pages/ActivityPage.tsx',
].map((file) => ({ file, text: read(`../src/admin/${file}`) }));

const sliceBetween = (sql: string, start: string, end: string): string => {
  const from = sql.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = sql.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
};

const MANAGED_TABLES = [
  'categories',
  'stations',
  'songs',
  'suggestions',
  'votes',
  'station_events',
  'site_settings',
  'admin_activity_logs',
  'song_likes',
] as const;

const TOKEN_TABLES = ['votes', 'station_events', 'song_likes'] as const;

describe('open panel migration — the authorization layer is retired', () => {
  it('drops the is_admin() policies before the functions they parse', () => {
    expect(migration8).toContain('drop policy if exists %I on public.%I');
    const policyDrop = migration8.indexOf('drop policy if exists');
    const functionDrop = migration8.indexOf('drop function if exists public.is_admin()');
    expect(policyDrop).toBeGreaterThanOrEqual(0);
    expect(functionDrop).toBeGreaterThan(policyDrop);
  });

  it('drops admin_users, is_admin() and admin_role() outright', () => {
    expect(migration8).toContain('drop table if exists public.admin_users cascade;');
    expect(migration8).toContain('drop function if exists public.is_admin();');
    expect(migration8).toContain('drop function if exists public.admin_role();');
    // Nothing may recreate them.
    expect(migration8).not.toMatch(/create table if not exists public\.admin_users/);
    expect(migration8).not.toMatch(/create or replace function public\.is_admin\(\)/);
  });

  it('documents the open-access tradeoff instead of hiding it', () => {
    expect(migration8).toMatch(/tradeoff/);
    expect(migration8).toMatch(/publishable/);
  });
});

describe('open panel migration — one open policy per managed table', () => {
  it('opens every managed table to both browser roles', () => {
    const section = sliceBetween(migration8, '-- 2) Open policies', '-- 3) Grants');
    for (const table of MANAGED_TABLES) {
      expect(section, table).toContain(`'${table}'`);
    }
    expect(section).toContain(
      "'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',",
    );
    expect(section).toContain("tbl || '_open_panel'");
    // song_likes gets its first RLS policy here; every other table keeps its
    // older policies alongside (policies OR together).
    expect(section).toContain('song_likes');
  });

  it('creates the policies idempotently (drop-if-exists first)', () => {
    expect(migration8).toMatch(
      /execute format\('drop policy if exists %I on public\.%I', tbl \|\| '_open_panel', tbl\)/,
    );
  });

  it('grants anon the panel verbs it needs', () => {
    // Content tables: full DML.
    expect(migration8).toMatch(
      /grant insert, update, delete on public\.categories, public\.stations, public\.songs\s+to anon;/,
    );
    expect(migration8).toContain('grant update, delete on public.suggestions to anon;');
    expect(migration8).toContain(
      'grant insert, update, delete on public.site_settings to anon;',
    );
    // The activity trigger writes as the calling role — anon needs insert.
    expect(migration8).toContain('grant insert, select on public.admin_activity_logs to anon;');
    // Targeted moderation deletes.
    expect(migration8).toContain('grant delete on public.votes to anon;');
    expect(migration8).toContain('grant delete on public.song_likes to anon;');
  });

  it('never grants table-level SELECT on the token tables', () => {
    for (const table of TOKEN_TABLES) {
      expect(migration8, table).not.toMatch(
        new RegExp(`grant select on public\\.${table}[^;]*\\banon\\b`),
      );
    }
  });
});

describe('open panel migration — visitor tokens stay write-only', () => {
  it('never puts visitor_token in any SELECT grant', () => {
    expect(migration8).not.toMatch(/grant select[^;]*visitor_token/);
  });

  it('reads token tables only through explicit token-free column lists', () => {
    const grants = [
      ...migration8.matchAll(/grant select \(([^)]*)\) on public\.(\w+) to anon;/g),
    ].map((match) => ({ columns: match[1], table: match[2] }));
    expect(grants.length).toBeGreaterThanOrEqual(3);
    for (const table of TOKEN_TABLES) {
      const tableGrants = grants.filter((grant) => grant.table === table);
      expect(tableGrants.length, table).toBeGreaterThan(0);
      for (const grant of tableGrants) {
        expect(grant.columns, table).not.toContain('visitor_token');
      }
    }
  });

  it('holds no password or key columns in either open-panel migration', () => {
    for (const sql of [migration4, migration8]) {
      expect(sql).not.toMatch(/\bpassword\s+(text|varchar)/i);
      expect(sql).not.toMatch(/service_role_key|secret\s+(text|varchar)/i);
    }
  });
});

describe('open panel migration — the audit log still records everything', () => {
  it('skips only JWT-less writes (SQL Editor and seeds stay out)', () => {
    expect(migration8).toContain("current_setting('request.jwt.claims', true)");
    expect(migration8).toContain("if claims = '{}'::jsonb then");
    // The old auth.uid() guard would have made the anon panel invisible.
    expect(migration8).not.toContain('if actor is null then');
  });

  it('labels open-panel writes honestly', () => {
    expect(migration8).toContain("coalesce(claims ->> 'email', 'open panel')");
    expect(migration8).toContain('actor := auth.uid();');
  });

  it('keeps review suggestion as its own action and writes the log table', () => {
    expect(migration8).toContain("action := 'review suggestion';");
    expect(migration8).toMatch(
      /insert into public\.admin_activity_logs\s+\(admin_id, admin_email, action, entity_type, entity_label, detail\)/,
    );
  });

  it('is not security definer — it relies on the anon insert grant instead', () => {
    const fn = migration8.slice(migration8.indexOf('create or replace function public.log_admin_activity()'));
    expect(fn.slice(0, 400)).not.toMatch(/security definer/);
    expect(migration8).toMatch(/create or replace function public\.log_admin_activity\(\)[\s\S]*?set search_path/);
  });
});

describe('migration 4 — history that still stands', () => {
  it('reads suggestions through a security-invoker view that omits the token', () => {
    const view =
      migration4.match(/create view public\.request_wall[\s\S]*?from public\.suggestions;/)?.[0] ?? '';
    expect(view).toContain('security_invoker = on');
    expect(view).not.toContain('visitor_token');
    for (const column of [
      'id',
      'song_url',
      'provider',
      'provider_id',
      'title',
      'artist',
      'artwork_url',
      'description',
      'station_id',
      'status',
      'played_at',
      'reviewed_at',
      'created_at',
      'updated_at',
    ]) {
      expect(view).toContain(column);
    }
  });

  it('never grants visitor_token to a browser role', () => {
    const grants = [
      ...migration4.matchAll(/grant select \(([\s\S]*?)\) on public\.suggestions to ([^;]+);/g),
    ];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant[1]).not.toContain('visitor_token');
      expect(grant[2]).toMatch(/anon, authenticated/);
    }
  });

  it('keeps request_wall readable by the public roles', () => {
    expect(migration4).toContain('grant select on public.request_wall to anon, authenticated;');
  });

  it('logs content/settings changes but never votes (no public flood)', () => {
    expect(migration4).toMatch(
      /create trigger %I_log_activity after insert or update or delete on public\.%I/,
    );
    const tables = sliceBetween(
      migration4,
      "foreach tbl in array array[\n    'categories', 'stations', 'songs', 'suggestions', 'site_settings', 'admin_users'",
      'end $$;',
    );
    expect(tables).toContain("'site_settings'");
    expect(tables).not.toContain("'votes'");
  });
});

describe('admin sources — client-side invariants', () => {
  it('has no password or email field anywhere in the admin panel', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/type=["'](password|email)/i);
    }
  });

  it('never writes to browser storage directly', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/localStorage|sessionStorage/);
    }
  });

  it('never references a service-role key', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/service_role|SERVICE_ROLE/);
    }
  });

  it('holds no sign-in remnants — no gate, no OTP, no identity props', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/AccessGate|OtpEntry|AccessDenied|AdminIdentity/);
      expect(text, file).not.toMatch(/onAccessLost|onSignOut|signInWith|verifyOtp/);
      expect(text, file).not.toMatch(/gateUtils/);
    }
    // gateUtils.ts itself must be gone from the tree.
    expect(() =>
      readFileSync(fileURLToPath(new URL('../src/admin/gateUtils.ts', import.meta.url)), 'utf8'),
    ).toThrow();
  });

  it('keeps the Supabase client sessionless (persistSession off, no refresh)', () => {
    const client = adminSources.find((entry) => entry.file === 'supabaseClient.ts')!.text;
    expect(client).toContain('persistSession: false');
    expect(client).toContain('autoRefreshToken: false');
    expect(client).toContain('detectSessionInUrl: false');
  });

  it('probes readiness against the open panel before showing the shell', () => {
    const app = adminSources.find((entry) => entry.file === 'AdminApp.tsx')!.text;
    expect(app).toContain("from('admin_activity_logs')");
    expect(app).toContain('Supabase is not configured');
  });
});

describe('routes — the control room has its own path', () => {
  it('maps /admin to the admin route and keeps the others intact', () => {
    expect(routeFromPathname('/admin')).toBe('admin');
    expect(routeFromPathname('/admin/')).toBe('admin');
    expect(routeFromPathname('/')).toBe('home');
    expect(routeFromPathname('/index.html')).toBe('home');
    expect(routeFromPathname('/suggest-music')).toBe('suggest');
    expect(routeFromPathname('/adminx')).toBe('home');
    expect(adminHref()).toBe('/admin');
  });
});

describe('admin errors — honest copy', () => {
  it('recognizes a missing migration as its own honest message', () => {
    expect(isMissingMigrationError('PGRST202')).toBe(true);
    expect(isMissingMigrationError('PGRST205')).toBe(true);
    expect(isMissingMigrationError('42P01')).toBe(true);
    expect(isMissingMigrationError('23505')).toBe(false);
    expect(MIGRATION_HINT).toMatch(/supabase\/migrations/);
    expect(mapDbError('PGRST202', 'Could not find the function')).toBe(MIGRATION_HINT);
    expect(mapDbError('42883', 'fn wall_board is missing')).toBe(MIGRATION_HINT);
  });

  it('maps a policy refusal to the open-panel migration, not a login hint', () => {
    expect(mapDbError('42501', 'policy')).toMatch(/policies predate the open panel/);
    expect(mapDbError('42501', 'policy')).not.toMatch(/Not authorized|sign in|session/i);
  });

  it('maps database failures to usable sentences', () => {
    expect(mapDbError('P0001', 'rate-limited: at most 3 suggestions per minute')).toBe(
      'rate-limited: at most 3 suggestions per minute',
    );
    expect(mapDbError('23505', 'duplicate key')).toMatch(/already exists/);
    expect(mapDbError('23503', 'fk violation')).toMatch(/reference/);
    expect(mapDbError('23502', 'null in column')).toMatch(/required field/);
    expect(mapDbError(null, null)).toMatch(/No changes were made/);
    expect(mapDbError(null, 'boom')).toContain('boom');
  });
});
