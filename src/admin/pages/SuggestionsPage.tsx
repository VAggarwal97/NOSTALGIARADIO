import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, formatWhen, pageErrorMessage } from '../pageSupport';
import { safeExternalUrl } from '../../lib/urlSafety';
import { SUGGESTION_STATUSES } from '../adminTypes';
import type { SuggestionRow, SuggestionStatus } from '../adminTypes';

/**
 * Suggestions — the moderation queue. Reads go through the token-free
 * `request_wall` view; writes hit the `suggestions` table and stamp
 * reviewed_at (never a reviewed_by identity: the panel has no session).
 * Per-row cleanup clears votes or likes through targeted deletes — the
 * counts are aggregates, so nothing stored ever has to be "fixed".
 */

type Filter = 'all' | SuggestionStatus;
type ConfirmMode = 'delete' | 'votes' | 'likes';

interface Tally {
  pending: number;
  approved: number;
  rejected: number;
  played: number;
}

interface Props {
  sb: SupabaseClient;
  onChanged: () => void;
}

const FILTERS: readonly Filter[] = ['pending', 'approved', 'rejected', 'played', 'all'];

const transitionVerb = (status: SuggestionStatus): string =>
  status === 'played' ? 'marked played' : `is now ${status}`;

export function SuggestionsPage({ sb, onChanged }: Props): JSX.Element {
  const [rows, setRows] = useState<SuggestionRow[] | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; mode: ConfirmMode } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [list, pending, approved, rejected, played, voteRows, likeRows] = await Promise.all([
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
      sb.from('song_like_counts').select('suggestion_id, likes'),
    ]);

    const failed = [list, pending, approved, rejected, played, voteRows, likeRows].find((r) => r.error);
    if (failed?.error) {
      setError(pageErrorMessage(failed.error));
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
    const voteMap: Record<string, number> = {};
    for (const row of (voteRows.data ?? []) as unknown as {
      suggestion_id: string | null;
      votes: number;
    }[]) {
      if (row.suggestion_id) voteMap[row.suggestion_id] = row.votes;
    }
    setVotes(voteMap);
    const likeMap: Record<string, number> = {};
    for (const row of (likeRows.data ?? []) as unknown as {
      suggestion_id: string | null;
      likes: number;
    }[]) {
      if (row.suggestion_id) likeMap[row.suggestion_id] = row.likes;
    }
    setLikes(likeMap);
  }, [sb]);

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
      })
      .eq('id', row.id);
    setBusyId(null);
    if (updateError) {
      setError(pageErrorMessage(updateError));
      return;
    }
    setMessage(`“${row.title}” ${transitionVerb(status)}.`);
    onChanged();
    await load();
  };

  const runConfirm = async (row: SuggestionRow): Promise<void> => {
    const mode = confirm?.mode;
    setBusyId(row.id);
    setError(null);
    let failure = null;
    if (mode === 'delete') {
      const { error: deleteError } = await sb.from('suggestions').delete().eq('id', row.id);
      failure = deleteError;
      if (!failure) setMessage(`Deleted “${row.title}” and its votes.`);
    } else if (mode === 'votes') {
      const { error: clearError } = await sb.from('votes').delete().eq('suggestion_id', row.id);
      failure = clearError;
      if (!failure) {
        setMessage(`Cleared ${votes[row.id] ?? 0} vote(s) on “${row.title}”.`);
      }
    } else if (mode === 'likes') {
      const { error: clearError } = await sb.from('song_likes').delete().eq('suggestion_id', row.id);
      failure = clearError;
      if (!failure) {
        setMessage(`Cleared ${likes[row.id] ?? 0} like(s) on “${row.title}”.`);
      }
    }
    setBusyId(null);
    setConfirm(null);
    if (failure) {
      setError(pageErrorMessage(failure));
      return;
    }
    onChanged();
    await load();
  };

  if (error && !rows) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!rows || !tally) return <LoadingRow label="Loading the moderation queue…" />;

  const total = tally.pending + tally.approved + tally.rejected + tally.played;
  const visible = filter === 'all' ? rows : rows.filter((row) => row.status === filter);

  const countFor = (key: Filter): number =>
    key === 'all' ? total : tally[key as SuggestionStatus];

  const confirmText = (row: SuggestionRow): string => {
    if (confirm?.mode === 'votes') {
      return `Clear ${votes[row.id] ?? 0} vote(s) on “${row.title}”? The count starts over.`;
    }
    if (confirm?.mode === 'likes') {
      return `Clear ${likes[row.id] ?? 0} like(s) on “${row.title}”? The count starts over.`;
    }
    return `Delete “${row.title}” and its votes? Cannot be undone.`;
  };

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
              setConfirm(null);
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
            Rows arrive here the moment someone sends one from the public wall
            — submissions land as approved and votable immediately (see
            supabase/README.md §10 for the two-browser check).
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
                  <th scope="col" className="admin-num">
                    Likes
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
                  const confirming = confirm?.id === row.id;
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
                      <td className="admin-num">{likes[row.id] ?? 0}</td>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>
                        <span className={`admin-badge admin-badge-${row.status}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="admin-row-actions">
                        {confirming ? (
                          <>
                            <span className="admin-confirm-text">{confirmText(row)}</span>
                            <button
                              type="button"
                              className="admin-danger"
                              disabled={busy}
                              onClick={() => void runConfirm(row)}
                            >
                              {busy
                                ? 'Working…'
                                : confirm?.mode === 'delete'
                                  ? 'Delete'
                                  : 'Clear'}
                            </button>
                            <button
                              type="button"
                              className="admin-ghost"
                              onClick={() => setConfirm(null)}
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
                            {(votes[row.id] ?? 0) > 0 ? (
                              <button
                                type="button"
                                className="admin-ghost"
                                disabled={busy}
                                onClick={() => setConfirm({ id: row.id, mode: 'votes' })}
                              >
                                Clear votes
                              </button>
                            ) : null}
                            {(likes[row.id] ?? 0) > 0 ? (
                              <button
                                type="button"
                                className="admin-ghost"
                                disabled={busy}
                                onClick={() => setConfirm({ id: row.id, mode: 'likes' })}
                              >
                                Clear likes
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="admin-danger"
                              disabled={busy}
                              onClick={() => setConfirm({ id: row.id, mode: 'delete' })}
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
        move them, and every move lands in the activity log.
      </p>
      <span className="visually-hidden">
        Known statuses: {SUGGESTION_STATUSES.join(', ')}.
      </span>
    </div>
  );
}
