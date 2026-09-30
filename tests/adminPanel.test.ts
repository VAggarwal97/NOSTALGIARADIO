import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { adminHref, routeFromPathname } from '../src/lib/routes';
import {
  MIGRATION_HINT,
  isMissingMigrationError,
  isValidEmail,
  mapDbError,
  mapSendError,
  mapVerifyError,
  maskEmail,
} from '../src/admin/gateUtils';

/**
 * Admin panel invariants — the security of /admin lives in SQL, so the SQL is
 * what this file pins down:
 *
 *  1. Authorization is a server-side, security-definer decision the browser
 *     cannot skip (email gate is UX; RLS is the wall).
 *  2. visitor_token never reaches any grant or view.
 *  3. The audit log is trigger-written, session-scoped and secret-free.
 *  4. The React side holds no passwords, no storage writes, no service keys.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const migration = read('../supabase/migrations/20260930000004_admin_panel.sql');

const adminSources = [
  'AdminApp.tsx',
  'AdminShell.tsx',
  'supabaseClient.ts',
  'gateUtils.ts',
  'adminTypes.ts',
  'pageSupport.tsx',
  'pages/DashboardPage.tsx',
  'pages/SuggestionsPage.tsx',
  'pages/ActivityPage.tsx',
].map((file) => ({ file, text: read(`../src/admin/${file}`) }));

const sliceBetween = (sql: string, start: string, end: string): string => {
  const from = sql.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = sql.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
};

describe('admin migration — authorization spine', () => {
  it('keeps both authorization probes security-definer with a pinned search_path', () => {
    expect(migration).toMatch(
      /create or replace function public\.is_admin\(\)[\s\S]*?security definer[\s\S]*?set search_path = public/,
    );
    expect(migration).toMatch(
      /create or replace function public\.admin_role\(\)[\s\S]*?security definer[\s\S]*?set search_path = public/,
    );
  });

  it('grants execute only to authenticated and service_role — never anon', () => {
    expect(migration).toContain('revoke execute on function public.is_admin() from public;');
    expect(migration).toContain('revoke execute on function public.admin_role() from public;');
    const grants = [...migration.matchAll(/grant execute on function[\s\S]*?;/g)].map((match) => match[0]);
    expect(grants.length).toBeGreaterThanOrEqual(1);
    for (const grant of grants) {
      const roles = grant.slice(grant.indexOf(' to ') + 4);
      expect(roles).not.toMatch(/\banon\b/);
      expect(roles).not.toMatch(/\bpublic\b/);
      expect(roles).toMatch(/authenticated/);
      expect(roles).toMatch(/service_role/);
    }
  });

  it('gives active admins full CRUD on every managed table, and nobody else', () => {
    const section = sliceBetween(migration, '-- Admin full access', 'end $$;');
    for (const table of [
      'categories',
      'stations',
      'songs',
      'suggestions',
      'votes',
      'station_events',
      'site_settings',
      'admin_users',
      'admin_activity_logs',
    ]) {
      expect(section).toContain(`'${table}'`);
    }
    expect(section).toContain('using (public.is_admin()) with check (public.is_admin())');
  });

  it('enables RLS on the three new tables', () => {
    for (const table of ['admin_users', 'admin_activity_logs', 'site_settings']) {
      expect(migration).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security;`),
      );
    }
  });

  it('exposes settings to the public only when explicitly flagged', () => {
    const policy = migration.slice(
      migration.indexOf('create policy "public reads visible settings"'),
    );
    expect(policy.slice(0, 400)).toMatch(/using \(publicly_visible = true\)/);
  });

  it('grants no new public read of votes or station events', () => {
    expect(migration).not.toMatch(/grant select on public\.votes[^;]*\banon\b/);
    expect(migration).not.toMatch(/on public\.votes for select/);
    expect(migration).not.toMatch(/on public\.station_events for select/);
  });

  it('holds no password or key columns anywhere', () => {
    expect(migration).not.toMatch(/\bpassword\s+(text|varchar)/i);
    expect(migration).not.toMatch(/service_role_key|secret\s+(text|varchar)/i);
  });
});

describe('admin migration — visitor tokens stay private', () => {
  it('reads suggestions through a security-invoker view that omits the token', () => {
    const view =
      migration.match(/create view public\.request_wall[\s\S]*?from public\.suggestions;/)?.[0] ?? '';
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
    const grants = [...migration.matchAll(/grant select \(([\s\S]*?)\) on public\.suggestions to ([^;]+);/g)];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant[1]).not.toContain('visitor_token');
      expect(grant[2]).toMatch(/anon, authenticated/);
    }
  });

  it('keeps request_wall readable by the public roles', () => {
    expect(migration).toContain('grant select on public.request_wall to anon, authenticated;');
  });
});

describe('admin migration — audit log', () => {
  it('skips writes that carry no session (SQL Editor and seeds stay out)', () => {
    expect(migration).toContain('if actor is null then');
    expect(migration).toMatch(
      /create trigger %I_log_activity after insert or update or delete on public\.%I/,
    );
    const tables = sliceBetween(migration, "foreach tbl in array array[\n    'categories', 'stations', 'songs', 'suggestions', 'site_settings', 'admin_users'", 'end $$;');
    expect(tables).toContain("'site_settings'");
    expect(tables).not.toContain("'votes'");
  });

  it('records sign-ins and suggestion reviews as their own actions', () => {
    expect(migration).toContain("action := 'sign in';");
    expect(migration).toContain("action := 'review suggestion';");
  });

  it('stores no secrets in the log table', () => {
    const logTable =
      migration.match(/create table if not exists public\.admin_activity_logs \([\s\S]*?\n\);/)?.[0] ?? '';
    expect(logTable).not.toMatch(/token|password|secret/i);
    expect(logTable).toMatch(/admin_email/);
  });
});

describe('admin sources — client-side invariants', () => {
  it('has no password field anywhere in the admin panel', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/type=["']password/i);
    }
  });

  it('never writes to browser storage directly (sessions belong to Supabase Auth)', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/localStorage|sessionStorage/);
    }
  });

  it('never references a service-role key', () => {
    for (const { file, text } of adminSources) {
      expect(text, file).not.toMatch(/service_role|SERVICE_ROLE/);
    }
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

describe('gate utilities — honest copy', () => {
  it('validates email shape', () => {
    expect(isValidEmail('admin@nostalgiaradio.com')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.domain.co')).toBe(true);
    expect(isValidEmail('admin@')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('has space@x.co')).toBe(false);
  });

  it('masks the address on the verification screen', () => {
    expect(maskEmail('admin@nostalgiaradio.com')).toBe('a••••@nostalgiaradio.com');
    expect(maskEmail('ab@x.co')).toBe('a••@x.co');
    expect(maskEmail('broken')).toBe('•••');
  });

  it('recognizes a missing migration as its own honest message', () => {
    expect(isMissingMigrationError('PGRST202')).toBe(true);
    expect(isMissingMigrationError('42P01')).toBe(true);
    expect(isMissingMigrationError('23505')).toBe(false);
    expect(mapDbError('PGRST202', 'Could not find the function')).toBe(MIGRATION_HINT);
    expect(mapDbError('42883', 'fn is_admin is missing')).toBe(MIGRATION_HINT);
  });

  it('maps authorization and database failures to usable sentences', () => {
    expect(mapDbError('42501', 'policy')).toMatch(/Not authorized/);
    expect(mapDbError('P0001', 'rate-limited: at most 3 suggestions per minute')).toBe(
      'rate-limited: at most 3 suggestions per minute',
    );
    expect(mapDbError('23505', 'duplicate key')).toMatch(/already exists/);
    expect(mapDbError(null, null)).toMatch(/No changes were made/);
    expect(mapDbError(null, 'boom')).toContain('boom');
  });

  it('maps OTP and send failures without leaking internals', () => {
    expect(mapVerifyError('OTP has expired')).toMatch(/expired/);
    expect(mapVerifyError('Invalid login credentials')).toMatch(/did not work/);
    expect(mapVerifyError('rate limit exceeded')).toMatch(/Wait a minute/);
    expect(mapVerifyError('')).toMatch(/could not be verified/);
    expect(mapSendError('rate limit exceeded')).toMatch(/Wait a minute/);
    expect(mapSendError('boom')).toMatch(/could not be sent/);
  });
});
