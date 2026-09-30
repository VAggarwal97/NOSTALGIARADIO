import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, formatWhen, pageErrorMessage } from '../pageSupport';
import type { ActivityRow } from '../adminTypes';

/**
 * Activity log (spec §56) — rows are written by database triggers, not by
 * this client, so a modified front end cannot hide what happened. Only
 * session-authenticated actions are recorded; SQL Editor changes are excluded
 * by design (documented in migration 4).
 */

interface Props {
  sb: SupabaseClient;
  onAccessLost: () => void;
}

export function ActivityPage({ sb, onAccessLost }: Props): JSX.Element {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await sb
      .from('admin_activity_logs')
      .select('id, admin_email, action, entity_type, entity_label, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (fetchError) {
      setError(pageErrorMessage(fetchError, onAccessLost));
      setRows(null);
      return;
    }
    setRows((data ?? []) as unknown as ActivityRow[]);
  }, [sb, onAccessLost]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!rows) return <LoadingRow label="Loading the activity log…" />;

  if (rows.length === 0) {
    return (
      <div className="admin-page">
        <div className="admin-panel admin-empty">
          <p>No activity recorded yet.</p>
          <p className="admin-note">
            Sign-ins and every content or settings change appear here
            automatically, written by the database itself.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Admin</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatWhen(row.created_at)}</td>
                <td>{row.admin_email ?? 'unknown'}</td>
                <td>
                  <span className="admin-action">{row.action}</span>
                </td>
                <td>
                  {row.entity_label ?? '—'}
                  {row.entity_type ? (
                    <span className="admin-cell-muted"> · {row.entity_type}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-note">
        Newest 100 entries. No authentication secrets are ever written here.
      </p>
    </div>
  );
}
