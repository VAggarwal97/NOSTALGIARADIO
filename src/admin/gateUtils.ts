/**
 * Pure helpers for the admin access gate and its error copy — no React, no
 * Supabase: unit-tested directly in tests/adminPanel.test.ts.
 *
 * Error handling follows the site rule: never "something went wrong". Every
 * message says what failed and what the admin can do next (spec §80).
 */

export const isValidEmail = (value: string): boolean =>
  /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(value);

/** `admin@nostalgiaradio.com` → `a••••@nostalgiaradio.com` — the verification
 *  screen never echoes the full address back (spec §83). */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const bullets = '•'.repeat(Math.min(Math.max(name.length - 1, 2), 6));
  return `${name.slice(0, 1)}${bullets}${domain}`;
};

/** Sent when a required table/function is missing — the honest answer when
 *  someone opens /admin before running the migrations. */
export const MIGRATION_HINT =
  'The database is not ready yet. Run the files in supabase/migrations in order, then retry. See supabase/README.md §1.';

const MIGRATION_MISSING_CODES = new Set([
  'PGRST202', // PostgREST: function does not exist (is_admin not migrated)
  'PGRST205', // PostgREST: relation does not exist (view/table not migrated)
  '42P01', // undefined_table
  '42883', // undefined_function
]);

export const isMissingMigrationError = (code: string | null | undefined): boolean =>
  Boolean(code && MIGRATION_MISSING_CODES.has(code));

export const mapSendError = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute, then request another code.';
  }
  if (m.includes('email')) {
    return 'The code could not be sent to that address. Check it and try again.';
  }
  return 'The code could not be sent. Check the address and try again.';
};

export const mapVerifyError = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'That code expired. Request a new one from the gate.';
  if (m.includes('invalid') || m.includes('match') || m.includes('token')) {
    return 'That code did not work. Check the email and try again.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute, then try again.';
  }
  return 'The code could not be verified. Try again, or request a new one.';
};

/** Translate a PostgREST/Postgres error into an admin-facing sentence. */
export const mapDbError = (
  code: string | null | undefined,
  message: string | null | undefined,
): string => {
  if (isMissingMigrationError(code)) return MIGRATION_HINT;
  if (code === '42501') {
    return 'Not authorized — your admin access may have been revoked.';
  }
  if (code === 'P0001') {
    // Database triggers raise these (rate limits); the message is ours already.
    return message ?? 'The database refused this change.';
  }
  if (code === '23505') return 'That record already exists.';
  if (code === '23503') {
    return 'That change would break a reference — check the related records first.';
  }
  return message
    ? `The database request failed. ${message} No changes were made.`
    : 'The database request failed. No changes were made.';
};
