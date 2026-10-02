/**
 * Pure error mapping for the open control room — no React, no Supabase:
 * unit-tested directly in tests/adminPanel.test.ts.
 *
 * Error handling follows the site rule: never "something went wrong". Every
 * message says what failed and what the admin can do next.
 */

/** Sent when a required table/function is missing — the honest answer when
 *  someone opens /admin before running the migrations (or against a database
 *  that predates migration 8's open panel). */
export const MIGRATION_HINT =
  'The database is not ready yet. Run the files in supabase/migrations in order, then retry. See supabase/README.md §1.';

const MIGRATION_MISSING_CODES = new Set([
  'PGRST202', // PostgREST: function does not exist
  'PGRST205', // PostgREST: relation does not exist (view/table not migrated)
  '42P01', // undefined_table
  '42883', // undefined_function
]);

export const isMissingMigrationError = (code: string | null | undefined): boolean =>
  Boolean(code && MIGRATION_MISSING_CODES.has(code));

/** Translate a PostgREST/Postgres error into an admin-facing sentence. */
export const mapDbError = (
  code: string | null | undefined,
  message: string | null | undefined,
): string => {
  if (isMissingMigrationError(code)) return MIGRATION_HINT;
  if (code === '42501') {
    // With the panel open (migration 8) this means the database predates it:
    // the policies this code expects are not there yet.
    return `${MIGRATION_HINT} (The database refused this change: its policies predate the open panel.)`;
  }
  if (code === 'P0001') {
    // Database triggers raise these (rate limits); the message is ours already.
    return message ?? 'The database refused this change.';
  }
  if (code === '23505') return 'That record already exists.';
  if (code === '23503') {
    return 'That change would break a reference — check the related records first.';
  }
  if (code === '23502') {
    return `A required field is missing. ${message ?? ''}`.trim();
  }
  if (code === '22P02' || code === '22007' || code === '22008') {
    return `A value has the wrong shape. ${message ?? ''}`.trim();
  }
  return message
    ? `The database request failed. ${message} No changes were made.`
    : 'The database request failed. No changes were made.';
};
