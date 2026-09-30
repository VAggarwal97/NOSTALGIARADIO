import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, pageErrorMessage } from '../pageSupport';

/**
 * Dashboard — everything on it is measured live from this page's own queries;
 * nothing is decorative (spec §6–§8). Content editors (categories/stations/
 * songs) are the next round; until then the note points at the Table Editor.
 */

interface Counts {
  categoriesActive: number;
  categoriesTotal: number;
  stationsActive: number;
  stationsTotal: number;
  songsActive: number;
  songsTotal: number;
  pending: number;
  approved: number;
  rejected: number;
  played: number;
  votes: number;
}

interface Props {
  sb: SupabaseClient;
  onAccessLost: () => void;
}

const greetingFor = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export function DashboardPage({ sb, onAccessLost }: Props): JSX.Element {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [cats, stations, songsTotal, songsActive, pending, approved, rejected, played, votes] =
      await Promise.all([
        sb.from('categories').select('active'),
        sb.from('stations').select('active'),
        sb.from('songs').select('id', { count: 'exact', head: true }),
        sb.from('songs').select('id', { count: 'exact', head: true }).eq('active', true),
        sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
        sb.from('request_wall').select('id', { count: 'exact', head: true }).eq('status', 'played'),
        sb.from('votes').select('id', { count: 'exact', head: true }),
      ]);

    const results = [cats, stations, songsTotal, songsActive, pending, approved, rejected, played, votes];
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setError(pageErrorMessage(failed.error, onAccessLost));
      setCounts(null);
      return;
    }

    const catRows = (cats.data ?? []) as unknown as { active: boolean }[];
    const stationRows = (stations.data ?? []) as unknown as { active: boolean }[];
    const activeCount = (rows: { active: boolean }[]): number =>
      rows.filter((row) => row.active).length;

    setCounts({
      categoriesActive: activeCount(catRows),
      categoriesTotal: catRows.length,
      stationsActive: activeCount(stationRows),
      stationsTotal: stationRows.length,
      songsActive: songsActive.count ?? 0,
      songsTotal: songsTotal.count ?? 0,
      pending: pending.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      played: played.count ?? 0,
      votes: votes.count ?? 0,
    });
  }, [sb, onAccessLost]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!counts) return <LoadingRow label="Measuring the catalogue…" />;

  const suggestionsTotal = counts.pending + counts.approved + counts.rejected + counts.played;

  return (
    <div className="admin-page">
      <p className="admin-greeting">
        {greetingFor()}, Admin{' '}
        <span className="admin-note-inline">— every number below is measured live.</span>
      </p>

      {counts.pending > 0 ? (
        <div className="admin-banner" role="status">
          <span aria-hidden="true">⚠</span> {counts.pending} suggestion
          {counts.pending === 1 ? '' : 's'} awaiting review{' '}
          <a href="#suggestions">Review now</a>
        </div>
      ) : null}

      <section className="admin-panel" aria-labelledby="sys-status">
        <h2 id="sys-status" className="admin-panel-title">
          System status
        </h2>
        <ul className="admin-status-grid">
          <li>
            <span className="admin-dot admin-dot-ok" aria-hidden="true" /> Database{' '}
            <span className="admin-status-value">Healthy — this page’s queries answered</span>
          </li>
          <li>
            <span className="admin-dot admin-dot-ok" aria-hidden="true" /> Authentication{' '}
            <span className="admin-status-value">Verified — server-side access check passed</span>
          </li>
          <li>
            <span className="admin-dot admin-dot-ok" aria-hidden="true" /> API{' '}
            <span className="admin-status-value">Reachable — PostgREST round-trip</span>
          </li>
          <li>
            <span className="admin-dot admin-dot-mute" aria-hidden="true" /> Storage / audio{' '}
            <span className="admin-status-value">Not monitored yet</span>
          </li>
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="content-stats">
        <h2 id="content-stats" className="admin-panel-title">
          Content
        </h2>
        <div className="admin-stat-grid">
          <div className="admin-stat">
            <p className="admin-stat-value">
              {counts.categoriesActive}
              <span className="admin-stat-sub">/{counts.categoriesTotal}</span>
            </p>
            <p className="admin-stat-label">Active categories</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-value">
              {counts.stationsActive}
              <span className="admin-stat-sub">/{counts.stationsTotal}</span>
            </p>
            <p className="admin-stat-label">Active stations</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-value">
              {counts.songsActive}
              <span className="admin-stat-sub">/{counts.songsTotal}</span>
            </p>
            <p className="admin-stat-label">Active songs</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-value">{suggestionsTotal}</p>
            <p className="admin-stat-label">Suggestions</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-value">{counts.votes}</p>
            <p className="admin-stat-label">Votes</p>
          </div>
        </div>
        <p className="admin-note">
          Editors for categories, stations and songs arrive in the next round —
          until then, content changes happen in the Supabase Table Editor (see
          supabase/README.md §4).
        </p>
      </section>

      <section className="admin-panel" aria-labelledby="community-stats">
        <h2 id="community-stats" className="admin-panel-title">
          Community
        </h2>
        <div className="admin-breakdown">
          <span className="admin-badge admin-badge-pending">{counts.pending} pending</span>
          <span className="admin-badge admin-badge-approved">{counts.approved} approved</span>
          <span className="admin-badge admin-badge-rejected">{counts.rejected} rejected</span>
          <span className="admin-badge admin-badge-played">{counts.played} played</span>
        </div>
        <div className="admin-quick">
          <a className="admin-ghost" href="#suggestions">
            Review suggestions
          </a>
          <a className="admin-ghost" href="#activity">
            Open activity log
          </a>
        </div>
      </section>
    </div>
  );
}
