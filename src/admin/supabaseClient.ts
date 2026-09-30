import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The only place the admin panel touches Supabase credentials.
 *
 * - Read from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — the two
 *   publishable values from `.env.local` (never a service-role key: Vite would
 *   inline it into a public bundle and RLS would be meaningless).
 * - Nothing is constructed until someone actually opens `/admin`, and the
 *   client is a singleton, so SSR and the public pages never touch it.
 * - Without the env pair the gate shows an honest "not configured" screen
 *   instead of failing silently — the site itself never depends on this file.
 */

const readEnv = (name: string): string => {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
};

export const SUPABASE_URL = readEnv('VITE_SUPABASE_URL');
export const SUPABASE_PUBLISHABLE_KEY = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

export const isSupabaseConfigured = (): boolean =>
  Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let singleton: SupabaseClient | null = null;

/**
 * Lazily build the browser client. Session persistence is scoped to the admin
 * area with its own storage key — the public site still writes nothing to
 * storage; only the admin's own sign-in session lives here (documented in
 * supabase/README.md §9).
 */
export const getSupabase = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) return null;
  if (!singleton) {
    try {
      singleton = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Lets a magic-link click (if the email template includes one)
          // land back on /admin signed in; harmless when no code is in the URL.
          detectSessionInUrl: true,
          storageKey: 'nostalgia-admin-session',
        },
      });
    } catch (error) {
      // Bad values in .env.local must not crash the route — the gate explains
      // which variables to check.
      console.error('Supabase client failed to initialize', error);
      return null;
    }
  }
  return singleton;
};
