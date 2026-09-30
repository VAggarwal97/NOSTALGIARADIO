import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdminIdentity } from './adminTypes';
import { DashboardPage } from './pages/DashboardPage';
import { SuggestionsPage } from './pages/SuggestionsPage';
import { ActivityPage } from './pages/ActivityPage';

/**
 * The control-room chrome: dense dark sidebar (spec §63), hash-based sections
 * (`#dashboard`, `#suggestions`, `#activity` — shareable, back-button-friendly,
 * no router dependency), session footer with sign-out.
 *
 * Only implemented sections appear as links; the full sitemap lives in
 * supabase/README.md §9 with the round each part ships in. No dead menus.
 */

type PageId = 'dashboard' | 'suggestions' | 'activity';

const pageFromHash = (): PageId => {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#/, '');
  return raw === 'suggestions' || raw === 'activity' ? raw : 'dashboard';
};

interface ShellProps {
  sb: SupabaseClient;
  identity: AdminIdentity;
  onSignOut: () => void;
  /** A page saw RLS refuse it mid-use (42501) — the gate re-checks and likely
   *  shows Access denied. Frontend demotion only; the database already said no. */
  onAccessLost: () => void;
}

export function AdminShell({ sb, identity, onSignOut, onAccessLost }: ShellProps): JSX.Element {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [pending, setPending] = useState(0);
  /** Bumped by pages after any mutation so the sidebar badge stays truthful. */
  const [refreshTick, setRefreshTick] = useState(0);
  const markChanged = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Pending-review badge: one exact head count, refreshed on every change.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { count, error } = await sb
        .from('request_wall')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (!cancelled && !error) setPending(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, page, refreshTick]);

  const pageTitle =
    page === 'suggestions' ? 'Suggestions' : page === 'activity' ? 'Activity log' : 'Dashboard';

  return (
    <div className={`admin-shell${navOpen ? ' admin-nav-open' : ''}`}>
      <a className="admin-skip" href="#admin-main">
        Skip to content
      </a>

      <aside className="admin-side">
        <div className="admin-brand">
          <p className="admin-brand-name">NOSTALGIA RADIO</p>
          <p className="admin-brand-sub">Admin control center</p>
        </div>

        <nav className="admin-nav" aria-label="Admin sections">
          <p className="admin-nav-group">Overview</p>
          <a
            href="#dashboard"
            className="admin-nav-link"
            aria-current={page === 'dashboard' ? 'page' : undefined}
          >
            Dashboard
          </a>

          <p className="admin-nav-group">Community</p>
          <a
            href="#suggestions"
            className="admin-nav-link"
            aria-current={page === 'suggestions' ? 'page' : undefined}
          >
            Suggestions
            {pending > 0 ? (
              <span className="admin-nav-badge" aria-label={`${pending} pending review`}>
                {pending}
              </span>
            ) : null}
          </a>

          <p className="admin-nav-group">System</p>
          <a
            href="#activity"
            className="admin-nav-link"
            aria-current={page === 'activity' ? 'page' : undefined}
          >
            Activity log
          </a>
        </nav>

        <div className="admin-session">
          <p className="admin-session-role">
            <span className="admin-session-dot" aria-hidden="true" />
            Secure session
          </p>
          <p className="admin-session-email" title={identity.email}>
            {identity.email}
          </p>
          <p className="admin-session-role-label">{identity.role}</p>
          <div className="admin-session-actions">
            <a className="admin-ghost" href="/">
              Back to the radio
            </a>
            <button className="admin-ghost" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="admin-menu"
            type="button"
            aria-expanded={navOpen}
            aria-label={navOpen ? 'Close admin navigation' : 'Open admin navigation'}
            onClick={() => setNavOpen((open) => !open)}
          >
            ☰
          </button>
          <h1 className="admin-page-title">{pageTitle}</h1>
          <p className="admin-topbar-role">{identity.role}</p>
        </header>

        <main id="admin-main" className="admin-content" tabIndex={-1}>
          {page === 'suggestions' ? (
            <SuggestionsPage
              sb={sb}
              identity={identity}
              onChanged={markChanged}
              onAccessLost={onAccessLost}
            />
          ) : page === 'activity' ? (
            <ActivityPage sb={sb} onAccessLost={onAccessLost} />
          ) : (
            <DashboardPage sb={sb} onAccessLost={onAccessLost} />
          )}
        </main>
      </div>
    </div>
  );
}
