import { useCallback, useEffect, useRef, useState } from 'react';

import { getRequestApi } from '../lib/request-api';
import type { RequestTab, SongRequest } from '../lib/request-api';

interface RequestBoardProps {
  /** Deep-linked or just-submitted request: scroll to it, flash it. */
  spotlightId: string | null;
  /** True when a shared /?request= id no longer exists. */
  requestedMissing: boolean;
  /** Focuses the console ("+ suggest the first song"). */
  onRequestFirst: () => void;
  onShare: (request: SongRequest) => void;
  /** The request on air right now — its card swaps Play for the On air state. */
  activeRequestId: string | null;
  /** "► Play" on an open card: hear this request immediately. */
  onPlayRequest: (request: SongRequest) => void;
  /** After a confirmed vote: the silent radio may air it (App decides). */
  onMaybeAir: (request: SongRequest) => void;
}

type Load = { items: SongRequest[]; total: number } | null;

const TABS: ReadonlyArray<{ id: RequestTab; label: string }> = [
  { id: 'wanted', label: 'Most wanted' },
  { id: 'rising', label: 'Rising' },
  { id: 'recent', label: 'Recently added' },
  { id: 'played', label: 'Played' },
];

/** Featured eyebrow per tab — honest about what the #1 item actually is. */
const LEADER_LABEL: Record<RequestTab, string> = {
  wanted: 'Currently leading',
  rising: 'Rising fast',
  recent: 'Just added',
  played: 'Last played',
};

const TAB_EMPTY: Record<RequestTab, { title: string; copy: string }> = {
  wanted: { title: 'No open requests', copy: 'Everything here has reached the radio.' },
  rising: { title: 'Nothing is rising yet', copy: 'Give a song its first vote to start something.' },
  recent: { title: 'Nothing new yet', copy: 'Fresh suggestions will surface here.' },
  played: { title: 'Nothing played yet', copy: 'Requests that reach the radio land here.' },
};

const formatVotes = (votes: number): string =>
  votes >= 1000 ? `${(votes / 1000).toFixed(1)}K` : `${votes}`;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * "What should play next?" — text tabs, a quiet search and honest cards.
 * Data comes from the request API only: loading shows loading, emptiness
 * shows emptiness, and a failed load offers a retry instead of fake rows.
 * Vote counts bump only after the API confirms, never before.
 */
export function RequestBoard({
  spotlightId,
  requestedMissing,
  onRequestFirst,
  onShare,
  activeRequestId,
  onPlayRequest,
  onMaybeAir,
}: RequestBoardProps) {
  const [tab, setTab] = useState<RequestTab>('wanted');
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>(null);
  const [failed, setFailed] = useState(false);
  const [pendingVote, setPendingVote] = useState<string | null>(null);
  const [voteNote, setVoteNote] = useState<{ id: string; text: string } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [nowLeading, setNowLeading] = useState(false);
  /** Set when this visitor votes; pays off only if that request takes #1. */
  const [leadingCandidate, setLeadingCandidate] = useState<string | null>(null);
  const votesBefore = useRef(new Map<string, number>());
  const [bumped, setBumped] = useState<Set<string>>(new Set());

  const api = getRequestApi();

  /**
   * What makes a board state worth re-rendering: identity, count, status,
   * "mine" and history. The convergence poll re-fetches every cycle; only a
   * real difference may move state (otherwise deep-linked spotlights would
   * re-flash every 20 seconds).
   */
  const fingerprintOf = (items: SongRequest[], total: number): string =>
    JSON.stringify([
      total,
      items.map((item) => [item.id, item.votes, item.status, item.mine, item.playedAt ?? 0]),
    ]);
  const loadFingerprint = useRef<string | null>(null);
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [items, all] = await Promise.all([api.board({ tab, query }), api.list()]);
      setFailed(false);
      hasData.current = true;
      const fingerprint = fingerprintOf(items, all.length);
      if (loadFingerprint.current === fingerprint) return; // nothing changed
      loadFingerprint.current = fingerprint;
      setLoad({ items, total: all.length });
    } catch {
      // Without data, say so honestly. With good data on screen, keep serving
      // it and let the next cycle retry — a blip must not blank the wall.
      setFailed(!hasData.current);
    }
  }, [api, tab, query]);

  useEffect(() => {
    setLoad(null);
    hasData.current = false;
    loadFingerprint.current = null;
    void refresh();
  }, [refresh]);

  // Live updates: this tab and neighbouring tabs both land here.
  useEffect(() => api.subscribe(() => void refresh()), [api, refresh]);

  // Count bumps: only when a number actually went up (our vote or a neighbour's).
  useEffect(() => {
    if (!load) return;
    const next = new Set<string>();
    for (const item of load.items) {
      const before = votesBefore.current.get(item.id);
      if (before !== undefined && item.votes > before) next.add(item.id);
      votesBefore.current.set(item.id, item.votes);
    }
    if (next.size > 0) {
      setBumped(next);
      const timer = window.setTimeout(() => setBumped(new Set()), 700);
      return () => window.clearTimeout(timer);
    }
  }, [load]);

  // ↑ NOW LEADING — shown only when the freshly voted request is actually #1.
  useEffect(() => {
    if (!load || !leadingCandidate) return;
    if (load.items[0]?.id !== leadingCandidate) {
      setLeadingCandidate(null);
      return;
    }
    setNowLeading(true);
    setLeadingCandidate(null);
    const timer = window.setTimeout(() => setNowLeading(false), 3200);
    return () => window.clearTimeout(timer);
  }, [load, leadingCandidate]);

  // Spotlight: scroll the shared/new request into view and flash it briefly.
  // If it isn't in the current view, switch to the view that holds it first.
  useEffect(() => {
    if (!load || !spotlightId) return;
    const element = document.getElementById(`request-${spotlightId}`);
    if (!element) {
      void api
        .get(spotlightId)
        .then((request) => {
          if (!request) return;
          const target: RequestTab = request.status === 'played' ? 'played' : 'wanted';
          setTab((current) => (current === target ? current : target));
        })
        .catch(() => {
          // Couldn't verify the shared id (outage): leave the board to load
          // on its own rather than claiming the request is gone.
        });
      return;
    }
    element.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    // Land keyboard/AT context on the shared or just-submitted request.
    element.focus({ preventScroll: true });
    setFlashId(spotlightId);
    const timer = window.setTimeout(() => setFlashId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [api, load, spotlightId]);

  const vote = useCallback(
    (request: SongRequest) => {
      if (pendingVote) return;
      setPendingVote(request.id);
      setVoteNote(null);
      // The count only moves when the API says so — never optimistically.
      void api
        .vote(request.id)
        .then((result) => {
          setPendingVote(null);
          if (result.ok) {
            setLeadingCandidate(result.request.id);
            // A vote is a fresh gesture: on a radio that never started, that's
            // enough to take the air. Anything already playing finishes first.
            onMaybeAir(result.request);
          } else if (result.reason === 'already-voted') {
            setVoteNote({ id: request.id, text: 'You have already voted' });
          } else if (result.reason === 'rate-limited') {
            setVoteNote({ id: request.id, text: 'Too many votes — wait a moment' });
          } else {
            setVoteNote({ id: request.id, text: 'Vote could not be confirmed' });
          }
        })
        .catch(() => {
          setPendingVote(null);
          setVoteNote({ id: request.id, text: 'Vote could not be confirmed' });
        });
    },
    [api, pendingVote, onMaybeAir],
  );

  const items = load?.items ?? null;
  const total = load?.total ?? 0;
  const featured = items && items.length > 0 ? items[0] : null;
  const rest = items ? items.slice(1) : [];

  return (
    <section className="board" aria-labelledby="board-title">
      <header className="board-head">
        <h2 id="board-title" className="board-title">
          What should play next?
        </h2>
        <p className="board-sub">The community is choosing what comes next.</p>

        <div className="board-controls">
          <div className="board-tabs" role="tablist" aria-label="Request views">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="board-panel"
                className="board-tab"
                data-on={tab === id ? 'true' : undefined}
                onClick={() => {
                  setTab(id);
                  setVoteNote(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="board-search">
            <span className="board-search-glyph" aria-hidden="true">
              ⌕
            </span>
            <span className="visually-hidden">Search requests</span>
            <input
              type="search"
              placeholder="Search songs or artists…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </header>

      <div id="board-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {requestedMissing ? (
          <p className="board-missing" role="alert">
            This request is no longer available.
          </p>
        ) : null}

        {failed ? (
          <div className="board-empty">
            <p className="board-empty-title">Unable to load requests right now.</p>
            <button type="button" className="board-cta" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : null}

        {!failed && items === null ? (
          <p className="board-loading" role="status">
            Loading requests…
          </p>
        ) : null}

        {!failed && items !== null && items.length === 0 ? (
          query.trim() ? (
            <div className="board-empty">
              <p className="board-empty-title">No requests found</p>
              <p className="board-empty-copy">Try another song or artist.</p>
            </div>
          ) : total === 0 ? (
            <div className="board-empty">
              <p className="board-empty-title">No requests yet</p>
              <p className="board-empty-copy">
                Be the first person to choose what Nostalgia Radio plays next.
              </p>
              <button type="button" className="board-cta" onClick={onRequestFirst}>
                + Suggest the first song
              </button>
            </div>
          ) : (
            <div className="board-empty">
              <p className="board-empty-title">{TAB_EMPTY[tab].title}</p>
              <p className="board-empty-copy">{TAB_EMPTY[tab].copy}</p>
            </div>
          )
        ) : null}

        {featured ? (
          <article
            id={`request-${featured.id}`}
            className="leader"
            data-flash={flashId === featured.id ? 'true' : undefined}
            tabIndex={-1}
          >
            <LeaderArt artwork={featured.artwork} />
            <div className="leader-body">
              <p className="leader-eyebrow">
                <span aria-hidden="true">#01</span> {LEADER_LABEL[tab]}
                {nowLeading && featured.mine ? <span className="leader-live"> ↑ now leading</span> : null}
              </p>
              <h3 className="leader-title">{featured.title}</h3>
              <p className="leader-artist">{featured.artist}</p>
              <p className="leader-provider">{providerLabel(featured)}</p>
              <p className={`leader-votes ${bumped.has(featured.id) ? 'is-bump' : ''}`} aria-live="polite">
                <span aria-hidden="true">▲</span> {formatVotes(featured.votes)}{' '}
                {featured.votes === 1 ? 'vote' : 'votes'}
              </p>
              <div className="leader-actions">
                {featured.status === 'open' ? (
                  <PlayButton
                    request={featured}
                    onAir={activeRequestId === featured.id}
                    onPlay={onPlayRequest}
                  />
                ) : null}
                <VoteButton
                  request={featured}
                  pending={pendingVote === featured.id}
                  onVote={vote}
                />
                <button type="button" className="share-btn" onClick={() => onShare(featured)}>
                  Share <span aria-hidden="true">↗</span>
                  <span className="visually-hidden">this request</span>
                </button>
              </div>
              {voteNote?.id === featured.id ? (
                <p className="vote-note" role="alert">
                  {voteNote.text}
                </p>
              ) : null}
            </div>
          </article>
        ) : null}

        {rest.length > 0 ? (
          <>
            <p className="board-grid-label">Community requests</p>
            <div className="request-grid">
              {rest.map((request, index) => (
                <article
                  key={request.id}
                  id={`request-${request.id}`}
                  className={`request-card ${flashId === request.id ? 'is-flash' : ''}`}
                  tabIndex={-1}
                >
                  <CardArt artwork={request.artwork} />
                  <div className="request-card-body">
                    <p className="request-rank">
                      #{String(index + 2).padStart(2, '0')}
                    </p>
                    <h3 className="request-title">{request.title}</h3>
                    <p className="request-artist">{request.artist}</p>
                    <p className="request-provider">{providerLabel(request)}</p>
                    <p
                      className={`request-votes ${bumped.has(request.id) ? 'is-bump' : ''}`}
                      aria-live="polite"
                    >
                      <span aria-hidden="true">▲</span> {formatVotes(request.votes)}
                    </p>
                    <div className="request-actions">
                      {request.status === 'open' ? (
                        <PlayButton
                          request={request}
                          onAir={activeRequestId === request.id}
                          onPlay={onPlayRequest}
                        />
                      ) : null}
                      <VoteButton request={request} pending={pendingVote === request.id} onVote={vote} />
                      <button
                        type="button"
                        className="share-btn share-btn--quiet"
                        onClick={() => onShare(request)}
                      >
                        Share <span aria-hidden="true">↗</span>
                        <span className="visually-hidden">this request</span>
                      </button>
                    </div>
                    {voteNote?.id === request.id ? (
                      <p className="vote-note" role="alert">
                        {voteNote.text}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

const providerLabel = (request: SongRequest) =>
  request.song.provider === 'spotify' ? 'Spotify' : 'YouTube';

/**
 * "► Play" — the listener's explicit way to hear a request right now, without
 * waiting for a boundary. While it's on air the card shows a live state instead
 * of a second play action. Hidden for played/unavailable items (no embed).
 */
function PlayButton({
  request,
  onAir,
  onPlay,
}: {
  request: SongRequest;
  onAir: boolean;
  onPlay: (request: SongRequest) => void;
}) {
  if (onAir) {
    return (
      <span className="play-req-btn play-req-btn--on">
        <span aria-hidden="true">●</span> On air
        <span className="visually-hidden"> — {request.title} is playing on the radio now</span>
      </span>
    );
  }
  return (
    <button type="button" className="play-req-btn" onClick={() => onPlay(request)}>
      <span aria-hidden="true">►</span> Play
      <span className="visually-hidden"> — hear {request.title} now</span>
    </button>
  );
}

function VoteButton({
  request,
  pending,
  onVote,
}: {
  request: SongRequest;
  pending: boolean;
  onVote: (request: SongRequest) => void;
}) {
  const voted = request.mine;
  return (
    <button
      type="button"
      className="vote-btn"
      data-voted={voted ? 'true' : undefined}
      aria-pressed={voted}
      disabled={voted || pending}
      onClick={() => onVote(request)}
    >
      <span aria-hidden="true">▲</span> {voted ? 'Voted' : pending ? 'Voting…' : 'Vote'}
      <span className="visually-hidden">
        {voted ? ` — you voted, ${request.votes} total` : ` for ${request.title}`}
      </span>
    </button>
  );
}

/** Artwork dominates the card; a monogram stands in when there is none. */
function CardArt({ artwork }: { artwork: string | null }) {
  const [broken, setBroken] = useState(false);
  if (artwork && !broken) {
    return (
      <img
        className="request-art"
        src={artwork}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className="request-art request-art--fallback" aria-hidden="true" />;
}

function LeaderArt({ artwork }: { artwork: string | null }) {
  const [broken, setBroken] = useState(false);
  if (artwork && !broken) {
    return (
      <img
        className="leader-art"
        src={artwork}
        alt=""
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className="leader-art leader-art--fallback" aria-hidden="true" />;
}
