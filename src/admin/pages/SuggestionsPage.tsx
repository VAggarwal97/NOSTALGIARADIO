import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, formatWhen, pageErrorMessage } from '../pageSupport';
import { safeExternalUrl } from '../../lib/urlSafety';
import { SUGGESTION_STATUSES } from '../adminTypes';
import type { AdminIdentity, SuggestionRow, SuggestionStatus } from '../adminTypes';

/**
 * Suggestions — the moderation queue (spec §33–§34). Reads go through the
 * token-free `request_wall` view; writes hit the `suggestions` table under the
 * admin RLS policy and stamp reviewed_at/reviewed_by. The public can never
 * read this list, change statuses or see tokens — that is enforced in SQL.
 */

type Filter = 'all' | SuggestionStatus;

interface Tally {
  pending: number;
  approved: number;
  rejected: number;
  played: number;
}

interface Props {
  sb: SupabaseClient;
  identity: AdminIdentity;
  onChanged: () => void;
  onAccessLost: () => void;
}

const FILTERS: readonly Filter[] = ['pending', 'approved', 'rejected', 'played', 'all'];

const transitionVerb = (status: SuggestionStatus): string =>
  status === 'played' ? 'marked played' : `is now ${status}`;

export function SuggestionsPage({ sb, identity, onChanged, onAccessLost }: Props): JSX.Element {
  const [rows, setRows] = useState<SuggestionRow[] | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [list, pending, approved, rejected, played, voteRows] = await Promise.all([
      sb
        .from('request_wall')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'played'),
      sb.from('suggestion_vote_counts').select('suggestion_id, votes'),
    ]);

    const failed = [list, pending, approved, rejected, played, voteRows].find((r) => r.error);
    if (failed?.error) {
      setError(pageErrorMessage(failed.error, onAccessLost));
      setRows(null);
      return;
    }

    setRows((list.data ?? []) as unknown as SuggestionRow[]);
    setTally({
      pending: pending.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      played: played.count ?? 0,
    });
    const map: Record<string, number> = {};
    for (const row of (voteRows.data ?? []) as unknown as {
      suggestion_id: string | null;
      votes: number;
    }[]) {
      if (row.suggestion_id) map[row.suggestion_id] = row.votes;
    }
    setVotes(map);
  }, [sb, onAccessLost]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (row: SuggestionRow, status: SuggestionStatus): Promise<void> => {
    setBusyId(row.id);
    setError(null);
    const { error: updateError } = await sb
      .from('suggestions')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: identity.id,
      })
      .eq('id', row.id);
    setBusyId(null);
    if (updateError) {
      setError(pageErrorMessage(updateError, onAccessLost));
      return;
    }
    setMessage(`“${row.title}” ${transitionVerb(status)}.`);
    onChanged();
    await load();
  };

  const remove = async (row: SuggestionRow): Promise<void> => {
    setBusyId(row.id);
    setError(null);
    const { error: deleteError } = await sb.from('suggestions').delete().eq('id', row.id);
    setBusyId(null);
    if (deleteError) {
      setError(pageErrorMessage(deleteError, onAccessLost));
      setConfirmId(null);
      return;
    }
    setMessage(`Deleted “${row.title}” and its votes.`);
    setConfirmId(null);
    onChanged();
    await load();
  };

  if (error && !rows) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!rows || !tally) return <LoadingRow label="Loading the moderation queue…" />;

  const total = tally.pending + tally.approved + tally.rejected + tally.played;
  const visible = filter === 'all' ? rows : rows.filter((row) => row.status === filter);

  const countFor = (key: Filter): number =>
    key === 'all' ? total : tally[key as SuggestionStatus];

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="group" aria-label="Filter suggestions by status">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={`admin-tab${filter === key ? ' admin-tab-on' : ''}`}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setConfirmId(null);
            }}
          >
            {key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1)}{' '}
            <span className="admin-tab-count">{countFor(key)}</span>
          </button>
        ))}
      </div>

      <p className="admin-status-line" role="status" aria-live="polite">
        {message ?? (error ?? '')}
      </p>

      {error && rows ? (
        <div className="admin-panel admin-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {total === 0 ? (
        <div className="admin-panel admin-empty">
          <p>No suggestions yet.</p>
          <p className="admin-note">
            This table fills when the public site is wired to Supabase (round in
            supabase/README.md §8). Until then, submissions stay in the
            device-local store.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="admin-panel admin-empty">
          <p>Nothing with status “{filter}” in the newest {rows.length}.</p>
        </div>
      ) : (
        <>
          {rows.length >= 100 ? (
            <p className="admin-note">Newest 100 shown — {total} in total.</p>
          ) : null}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Song</th>
                  <th scope="col">Artist</th>
                  <th scope="col" className="admin-num">
                    Votes
                  </th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const href = row.song_url ? safeExternalUrl(row.song_url) : null;
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className="admin-cell-title">{row.title}</span>
                        {href ? (
                          <a
                            className="admin-ext"
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Open source ↗
                          </a>
                        ) : null}
                      </td>
                      <td>{row.artist ?? '—'}</td>
                      <td className="admin-num">{votes[row.id] ?? 0}</td>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>
                        <span className={`admin-badge admin-badge-${row.status}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="admin-row-actions">
                        {confirmId === row.id ? (
                          <>
                            <span className="admin-confirm-text">
                              Delete “{row.title}” and its votes? Cannot be undone.
                            </span>
                            <button
                              type="button"
                              className="admin-danger"
                              disabled={busy}
                              onClick={() => void remove(row)}
                            >
                              {busy ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              className="admin-ghost"
                              onClick={() => setConfirmId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {row.status === 'pending' ? (
                              <>
                                <button
                                  type="button"
                                  className="admin-primary-sm"
                                  disabled={busy}
                                  onClick={() => void transition(row, 'approved')}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="admin-ghost"
                                  disabled={busy}
                                  onClick={() => void transition(row, 'rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {row.status === 'approved' ? (
                              <>
                                <button
                                  type="button"
                                  className="admin-ghost"
                                  disabled={busy}
                                  onClick={() => void transition(row, 'played')}
                                >
                                  Mark played
                                </button>
                                <button
                                  type="button"
                                  className="admin-ghost"
                                  disabled={busy}
                                  onClick={() => void transition(row, 'rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {row.status === 'rejected' ? (
                              <button
                                type="button"
                                className="admin-primary-sm"
                                disabled={busy}
                                onClick={() => void transition(row, 'approved')}
                              >
                                Approve
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="admin-danger"
                              disabled={busy}
                              onClick={() => setConfirmId(row.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="admin-note">
        Played entries stay read-only: they are history and never re-enter the
        queue. Statuses are locked in SQL — this panel only asks the database to
        move them.
      </p>
      <span className="visually-hidden">
        Known statuses: {SUGGESTION_STATUSES.join(', ')}.
      </span>
    </div>
  );
}
