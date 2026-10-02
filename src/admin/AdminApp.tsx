import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { mapDbError } from './adminErrors';
import { AdminShell } from './AdminShell';

import '../styles/admin.css';

/**
 * /admin — the open control room.
 *
 * There is no login anywhere: no email gate, no one-time code, no role check
 * in this file and none in the database (migration 8 retires admin_users,
 * is_admin() and the policies that asked for them). The panel runs on the
 * publishable key, so its database rules are the same ones any visitor's
 * browser can reach — the owner's explicit decision, its tradeoff written
 * down in supabase/README.md §9.
 *
 * What remains are honest states only: not configured, opening (a real
 * readiness probe against the open-panel migration), failed (with the
 * database's own explanation), ready.
 */

type Phase = 'boot' | 'error' | 'ready';

export function Unconfigured(): JSX.Element {
  return (
    <div className="admin-welcome" role="alert">
      <p className="admin-welcome-brand">NOSTALGIA RADIO</p>
      <h1 className="admin-welcome-title">Control room not configured</h1>
      <p className="admin-welcome-copy">
        Supabase is not configured. Add VITE_SUPABASE_URL and
        VITE_SUPABASE_PUBLISHABLE_KEY to <code>.env.local</code> (never commit
        it) and restart the dev server — see supabase/README.md §2.
      </p>
      <a className="admin-welcome-link" href="/">
        Back to the radio
      </a>
    </div>
  );
}

function BootCard(): JSX.Element {
  return (
    <div className="admin-welcome" role="status" aria-busy="true">
      <p className="admin-welcome-brand">NOSTALGIA RADIO</p>
      <p className="admin-welcome-line">Opening the control room…</p>
    </div>
  );
}

function DbError({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="admin-welcome" role="alert">
      <p className="admin-welcome-brand">NOSTALGIA RADIO</p>
      <h1 className="admin-welcome-title">Database not ready</h1>
      <p className="admin-welcome-copy">{message}</p>
      <button className="admin-welcome-link" type="button" onClick={onRetry}>
        Retry
      </button>
      <a className="admin-welcome-link" href="/">
        Back to the radio
      </a>
    </div>
  );
}

export default function AdminApp(): JSX.Element {
  const configured = isSupabaseConfigured();
  const sb: SupabaseClient | null = useMemo(
    () => (configured ? getSupabase() : null),
    [configured],
  );

  const [phase, setPhase] = useState<Phase>('boot');
  const [error, setError] = useState<string | null>(null);

  /** Readiness probe: the audit log is readable only once migration 8 opened
   *  the panel, so this one query proves the database matches this code. */
  const open = useCallback(async () => {
    if (!sb) return;
    setPhase('boot');
    setError(null);
    const { error: probeError } = await sb
      .from('admin_activity_logs')
      .select('id', { head: true, count: 'exact' });
    if (probeError) {
      setError(mapDbError(probeError.code, probeError.message));
      setPhase('error');
      return;
    }
    setPhase('ready');
  }, [sb]);

  useEffect(() => {
    void open();
  }, [open]);

  // A configured-but-broken client (bad URL in .env.local) lands here.
  if (!sb) return <Unconfigured />;

  if (phase === 'error') {
    return <DbError message={error ?? 'The database request failed.'} onRetry={() => void open()} />;
  }
  if (phase === 'boot') return <BootCard />;
  return <AdminShell sb={sb} />;
}
