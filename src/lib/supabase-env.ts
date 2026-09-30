/**
 * The two public Supabase values the community wall reads — the exact pair
 * `src/admin/supabaseClient.ts` reads for /admin (pinned together by a test).
 *
 * Nothing in this module imports `@supabase/supabase-js`: the public bundle
 * must stay able to tree-shake the database client into the async chunk that
 * only a *configured* build ever downloads (see `createSharedRequestApi` in
 * request-api.ts). No service-role key exists anywhere in client code — Vite
 * inlines every `VITE_*` value into a public bundle.
 */

const readViteEnv = (name: string): string => {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
};

/** Read lazily (not as module constants) so tests and HMR see changes. */
export const supabaseUrl = (): string => readViteEnv('VITE_SUPABASE_URL');

export const supabasePublishableKey = (): string =>
  readViteEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

/** Unconfigured → the site runs exactly as before: local store, offline. */
export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl() && supabasePublishableKey());
