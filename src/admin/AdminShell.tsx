import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { DashboardPage } from './pages/DashboardPage';
import { SuggestionsPage } from './pages/SuggestionsPage';
import { CataloguePage } from './pages/CataloguePage';
import { SettingsPage } from './pages/SettingsPage';
import { ActivityPage } from './pages/ActivityPage';

/**
 * The control-room chrome: dense dark sidebar, hash-based sections
 * (`#dashboard`, `#suggestions`, `#catalogue`, `#settings`, `#activity` —
 * shareable, back-button-friendly, no router dependency).
 *
 * There is no session footer by design: the panel has no sign-in (migration
 * 8), so the footer states that plainly instead of pretending a session
 * exists. Only implemented sections appear as links — no dead menus; the
 * full sitemap lives in supabase/README.md §9.
 */

type PageId = 'dashboard' | 'suggestions' | 'catalogue' | 'settings' | 'activity';

const PAGE_IDS: readonly string[] = ['dashboard', 'suggestions', 'catalogue', 'settings', 'activity'];

const pageFromHash = (): PageId => {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#/, '');
  return PAGE_IDS.includes(raw) ? (raw as PageId) : 'dashboard';
};

const PAGE_TITLES: Record<PageId, string> = {
  dashboard: 'Dashboard',
  suggestions: 'Suggestions',
  catalogue: 'Catalogue',
  settings: 'Settings',
  activity: 'Activity log',
};

interface ShellProps {
  sb: SupabaseClient;
}

export function AdminShell({ sb }: ShellProps): JSX.Element {
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

          <p className="admin-nav-group">Content</p>
          <a
            href="#catalogue"
            className="admin-nav-link"
            aria-current={page === 'catalogue' ? 'page' : undefined}
          >
            Catalogue
          </a>

          <p className="admin-nav-group">System</p>
          <a
            href="#settings"
            className="admin-nav-link"
            aria-current={page === 'settings' ? 'page' : undefined}
          >
            Settings
          </a>
          <a
            href="#activity"
            className="admin-nav-link"
            aria-current={page === 'activity' ? 'page' : undefined}
          >
            Activity log
          </a>
        </nav>

        <div className="admin-session">
          <p className="admin-session-state">
            <span className="admin-session-dot" aria-hidden="true" />
            Open access — no sign-in
          </p>
          <p className="admin-session-note">
            Anyone with this URL operates the radio's database. The tradeoff is
            documented in supabase/README.md §9.
          </p>
          <div className="admin-session-actions">
            <a className="admin-ghost" href="/">
              Back to the radio
            </a>
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
          <h1 className="admin-page-title">{PAGE_TITLES[page]}</h1>
          <p className="admin-topbar-role">Open panel</p>
        </header>

        <main id="admin-main" className="admin-content" tabIndex={-1}>
          {page === 'suggestions' ? (
            <SuggestionsPage sb={sb} onChanged={markChanged} />
          ) : page === 'catalogue' ? (
            <CataloguePage sb={sb} />
          ) : page === 'settings' ? (
            <SettingsPage sb={sb} />
          ) : page === 'activity' ? (
            <ActivityPage sb={sb} />
          ) : (
            <DashboardPage sb={sb} />
          )}
        </main>
      </div>
    </div>
  );
}
