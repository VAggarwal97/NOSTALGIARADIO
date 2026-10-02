import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';

import { CATEGORY_MAP, isCategoryId } from '../data/categories';
import { STATIONS } from '../data/stations';
import type { CategoryId, Station } from '../types/station';

import { findStation, randomStation, stationsForCategory } from '../lib/catalog';
import {
  decideSource,
  embedSourceForRequest,
  isPlayableDecision,
  navigateSource,
} from '../lib/sourcePolicy';
import {
  fallsBackToStations,
  pickNextRequest,
  radioIsSilent,
  requestStationId,
  retireReason,
} from '../lib/queue';
import type { QueueOrigin } from '../lib/queue';
import { getRequestApi } from '../lib/request-api';
import type { SongRequest } from '../lib/request-api';
import { shareStation } from '../lib/share';
import { stationAccent } from '../lib/hero';

import { useRadioPlayer } from '../hooks/useRadioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePresence } from '../hooks/usePresence';
import { hasVoted } from '../lib/community-identity';
import { communityPick } from '../lib/community-pick';
import { getPlayerManager } from '../services/playerManager';
import { routeFromPathname, suggestHref } from '../lib/routes';
import type { RouteName } from '../lib/routes';

import { HomeNav } from '../components/HomeNav';
import { CinematicHero } from '../components/CinematicHero';
import type { PlayerState } from '../components/CinematicHero';
import { FloatingPlayer } from '../components/FloatingPlayer';
import { EngineDock } from '../components/EngineDock';
import { CommunityControls } from '../components/CommunityControls';
import { StationInfoModal } from '../components/StationInfoModal';
import { HelpOverlay } from '../components/HelpOverlay';
import { Toast } from '../components/Toast';
import { SuggestPage } from '../components/SuggestPage';

/* Secondary systems download on demand — first paint never waits for them. */
const SearchOverlay = lazy(() =>
  import('../components/SearchOverlay').then((module) => ({ default: module.SearchOverlay })),
);

const queryParam = (name: string): string | null =>
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get(name);

/** Deep link first; otherwise the identity of the MIX chip. */
const initialState = (): { category: CategoryId; station: Station | null } => {
  const linked = findStation(queryParam('station'));
  const fromUrl = queryParam('category');
  const category: CategoryId = linked
    ? linked.category
    : fromUrl && isCategoryId(fromUrl)
      ? fromUrl
      : 'mix';
  const station =
    linked ?? findStation(CATEGORY_MAP[category]?.flagship) ?? STATIONS[0] ?? null;
  return { category, station };
};

/**
 * One page, one experience. The header's category chips are station selectors:
 * pressing one swaps the hero identity (artwork, title, copy, accent, track)
 * without navigating, reloading or changing layout.
 */
export default function App() {
  const [initial] = useState(initialState);
  const [category, setCategory] = useState<CategoryId>(initial.category);
  const [selected, setSelected] = useState<Station | null>(initial.station);

  // Two views, one shell: the radio screen and the community request wall.
  const [route, setRoute] = useState<RouteName>(() =>
    typeof window === 'undefined' ? 'home' : routeFromPathname(window.location.pathname),
  );

  // The control room (/admin) ships in its own chunk — the Supabase client and
  // every admin screen stay out of the public bundle until someone actually
  // opens /admin. SSR renders the loading line and never imports it. There is
  // no sign-in: the panel opens straight into the shell (migration 8).
  const [adminModule, setAdminModule] = useState<{ default: ComponentType } | null>(null);
  const [adminLoadFailed, setAdminLoadFailed] = useState(false);
  useEffect(() => {
    if (route !== 'admin' || adminModule) return;
    let cancelled = false;
    void import('../admin/AdminApp')
      .then((module) => {
        if (!cancelled) setAdminModule(module);
      })
      .catch(() => {
        if (!cancelled) setAdminLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [route, adminModule]);

  // What the community queue currently has on air — the pill, hero and dock
  // describe the request instead of pretending the station is playing.
  const [activeRequest, setActiveRequestState] = useState<SongRequest | null>(null);
  const activeRequestRef = useRef<SongRequest | null>(null);
  /** Requests whose source failed this session — skipped, never retried in-page. */
  const skipRef = useRef<Set<string>>(new Set());
  const failuresRef = useRef(0);
  const updateActiveRequest = useCallback((request: SongRequest | null) => {
    activeRequestRef.current = request;
    setActiveRequestState(request);
  }, []);

  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [compact, setCompact] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const toastTimer = useRef<number | null>(null);

  // Approximate live sessions — decorative, resolved after first paint.
  const listeners = usePresence();

  // The header tightens after the first scroll — same shell, smaller footprint.
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 48);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * History-API navigation between the two views: no reload, no lost player
   * state, and the back button behaves exactly as a visitor expects.
   */
  const navigate = useCallback((path: string) => {
    try {
      window.history.pushState({}, '', path);
    } catch {
      /* file:// or sandboxed context — links still work natively */
    }
    setRoute(routeFromPathname(window.location.pathname));
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPathname(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // The player hook keeps `onEnded` in a ref, so a stable trampoline reaches the
  // latest advance logic without re-creating the audio element.
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});
  const advanceRef = useRef<(origin: QueueOrigin) => void>(() => {});
  // Both engines land here: at every boundary (sample track ended, request
  // finished, playlist video changed) the community queue gets first refusal.
  const player = useRadioPlayer({
    onEnded: (origin) => advanceRef.current(origin ?? 'audio'),
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  const pool = useMemo(() => stationsForCategory(category), [category]);

  const goTo = useCallback(
    (station: Station, autoplay = false) => {
      setSelected(station);
      setAnnouncement(`${station.name}. ${station.description}`);

      try {
        const url = new URL(window.location.href);
        url.searchParams.set('station', station.id);
        url.searchParams.set('category', station.category);
        window.history.replaceState({}, '', url);
      } catch {
        /* file:// or sandboxed context — deep links are a convenience */
      }

      const decision = decideSource(station);
      const playable = isPlayableDecision(decision);
      if (autoplay && playable) {
        playerRef.current.load(station.id, decision);
        void playerRef.current.play();
      } else if (activeRequestRef.current) {
        // A community request was on air: replace it with the station — cued
        // paused when nothing should autoplay, stopped when this source can't
        // play here. The pill must never describe a request nobody loaded.
        if (playable) playerRef.current.load(station.id, decision);
        else playerRef.current.stop();
      }
      updateActiveRequest(null);
    },
    [updateActiveRequest],
  );

  const startStation = useCallback(
    async (station: Station) => {
      updateActiveRequest(null);
      const decision = decideSource(station);
      if (!isPlayableDecision(decision)) {
        notify('This station opens on its own page — nothing plays here.');
        navigateSource(station);
        return;
      }
      if (playerRef.current.stationId !== station.id) {
        playerRef.current.load(station.id, decision);
      }
      await playerRef.current.play();
    },
    [notify, updateActiveRequest],
  );

  const togglePlay = useCallback(async () => {
    const station = selected;
    if (!station) return;
    const current = playerRef.current;
    const requestOnAir = activeRequestRef.current;
    if (requestOnAir && current.stationId === requestStationId(requestOnAir.id)) {
      // The request owns playback right now — pause it, don't restart the station.
      await current.toggle();
      return;
    }
    const decision = decideSource(station);
    if (!isPlayableDecision(decision)) {
      notify('This station opens on its own page — nothing plays here.');
      navigateSource(station);
      return;
    }
    if (current.stationId === station.id && current.isPlayable) await current.toggle();
    else await startStation(station);
  }, [selected, startStation, notify]);

  /**
   * The core interaction: a chip selects a station set and the hero switches to
   * that category's flagship — same page, same layout, no route change.
   * Audio already playing keeps playing across the switch.
   */
  const selectCategory = useCallback(
    (id: CategoryId) => {
      setCategory(id);
      const flagship = findStation(CATEGORY_MAP[id]?.flagship);
      if (!flagship) return;
      const keepListening = playerRef.current.status === 'playing';
      goTo(flagship, keepListening && isPlayableDecision(decideSource(flagship)));
    },
    [goTo],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const list = pool.length > 0 ? pool : STATIONS;
      const index = selected ? list.findIndex((s) => s.id === selected.id) : -1;
      if (list.length === 0) return;
      const nextIndex =
        index === -1
          ? direction === 1
            ? 0
            : list.length - 1
          : (index + direction + list.length) % list.length;
      const target = list[nextIndex];
      if (!target) return;
      const shouldAutoplay = playerRef.current.status === 'playing';
      goTo(target, shouldAutoplay);
    },
    [pool, selected, goTo],
  );

  /** One request = one official provider embed, loaded like any other source. */
  const playRequest = useCallback(
    async (request: SongRequest): Promise<boolean> => {
      if (activeRequestRef.current?.id === request.id) return true; // already on air
      const source = embedSourceForRequest(request);
      if (!source) return false;
      updateActiveRequest(request);
      try {
        playerRef.current.load(requestStationId(request.id), { kind: 'embed', source });
        await playerRef.current.play();
      } catch {
        // Engine refused (blocked autoplay, dead iframe…) — it never aired, so it
        // stays open and the pill returns to the station instead of a stuck title.
        updateActiveRequest(null);
        return false;
      }
      setAnnouncement(`Now playing ${request.title} by ${request.artist} — community request.`);
      notify(`Now playing: ${request.title}`);
      return true;
    },
    [notify, updateActiveRequest],
  );

  /**
   * A submit or a vote may take the air right away — but only while the radio
   * has never started this session (nothing is playing to interrupt, and the
   * click is a live gesture). Once anything has played, the boundary rule owns
   * the hand-off: the current song always finishes first.
   */
  const maybeAir = useCallback(
    (request: SongRequest) => {
      if (!radioIsSilent(playerRef.current.status, activeRequestRef.current !== null)) return;
      void playRequest(request).then((started) => {
        if (!started) notify('Press ► Play on the request to hear it.');
      });
    },
    [notify, playRequest],
  );

  /** On-demand play from a request card: the listener's explicit "now". */
  const startRequest = useCallback(
    (request: SongRequest) => {
      void playRequest(request).then((started) => {
        if (!started) notify('This request could not start — try again.');
      });
    },
    [notify, playRequest],
  );

  /**
   * What airs at a boundary — a sample track ended, a request finished, or the
   * listener pressed Next. The highest-voted open request goes first; when the
   * queue is exhausted the station rotation resumes. The current song is never
   * interrupted: this only ever runs from a boundary, never mid-track.
   */
  const advanceProgram = useCallback(
    async (origin: QueueOrigin) => {
      const api = getRequestApi();
      const current = activeRequestRef.current;
      if (current && retireReason(origin)) {
        try {
          await api.markPlayed(current.id, current); // it aired → history; it never replays
        } catch {
          // History failed — the request simply stays open for a later rotation.
        }
      }
      if (current) updateActiveRequest(null);

      let items: SongRequest[] | null = null;
      try {
        items = await api.board({ tab: 'wanted' });
      } catch {
        items = null; // offline or API trouble → plain station behaviour, never a stall
      }
      const next = items ? pickNextRequest(items, skipRef.current, current?.id ?? null) : null;
      if (next && (await playRequest(next))) return;
      if (!fallsBackToStations(origin)) return; // the provider playlist manages itself
      failuresRef.current = 0;
      step(1);
    },
    [playRequest, step, updateActiveRequest],
  );

  stepRef.current = step;
  advanceRef.current = advanceProgram;

  // A request whose source fails is skipped for this session — the next
  // highest-voted one airs instead. Repeated failures end the queue cleanly.
  useEffect(() => {
    if (!activeRequest || player.status !== 'error') return;
    skipRef.current.add(activeRequest.id);
    updateActiveRequest(null);
    failuresRef.current += 1;
    if (failuresRef.current >= 3) {
      failuresRef.current = 0;
      step(1);
      return;
    }
    void advanceProgram('error');
  }, [activeRequest, player.status, advanceProgram, step, updateActiveRequest]);

  useEffect(() => {
    if (player.status === 'playing') failuresRef.current = 0;
  }, [player.status]);

  /** ← → seek a track with real duration; otherwise they move between stations. */
  const stepOrSeek = useCallback((direction: 1 | -1) => {
    const current = playerRef.current;
    if (current.duration > 0 && current.isPlayable && current.stationId) {
      const target = Math.min(Math.max(current.currentTime + direction * 10, 0), current.duration);
      current.seek(target);
      return;
    }
    stepRef.current(direction);
  }, []);

  const handleSelect = useCallback(
    (station: Station) => {
      setCategory(station.category);
      void startStation(station);
    },
    [startStation],
  );

  const handlePrimary = useCallback(
    (station: Station) => {
      const decision = decideSource(station);
      goTo(station);
      if (isPlayableDecision(decision)) {
        void startStation(station);
      } else {
        navigateSource(station);
        notify(
          decision.kind === 'check'
            ? 'Opening the station page to check availability.'
            : 'Source could not be validated.',
        );
      }
    },
    [goTo, startStation, notify],
  );

  const openSource = useCallback(
    (station: Station) => {
      const ok = navigateSource(station);
      notify(ok ? 'Opened in a new tab.' : 'This source failed validation and was not opened.');
    },
    [notify],
  );

  const share = useCallback(
    async (station: Station | null) => {
      if (!station) return;
      const result = await shareStation(station);
      if (result === 'copied') notify('Link copied to clipboard.');
      else if (result === 'shared') notify('Shared.');
      else if (result === 'failed') notify('Sharing is unavailable in this browser.');
    },
    [notify],
  );

  const surprise = useCallback(() => {
    const station = randomStation(selected?.id);
    setCategory(station.category);
    goTo(station, true);
    notify(`Surprise: ${station.name}`);
  }, [selected, goTo, notify]);

  const openSearch = useCallback(() => {
    setHelpOpen(false);
    setInfoOpen(false);
    setSearchOpen(true);
  }, []);

  const closeOverlays = useCallback(() => {
    setSearchOpen(false);
    setInfoOpen(false);
    setHelpOpen(false);
  }, []);

  /** Spotify embeds expose no volume API — say so instead of pretending to work. */
  const volumeGuard = useCallback(
    (action: () => void) => {
      if (!playerRef.current.hasVolume) {
        notify('This station plays through the Spotify player — use the volume inside it.');
        return;
      }
      action();
    },
    [notify],
  );

  useKeyboardShortcuts(
    {
      togglePlay: () => void togglePlay(),
      previous: () => stepOrSeek(-1),
      next: () => stepOrSeek(1),
      toggleMute: () => volumeGuard(() => player.toggleMute()),
      openSearch,
      toggleHelp: () => {
        setInfoOpen(false);
        setSearchOpen(false);
        setHelpOpen((open) => !open);
      },
      share: () => void share(selected),
      surprise,
      closeOverlays,
      volumeUp: () => volumeGuard(() => player.setVolume(player.volume + 0.1)),
      volumeDown: () => volumeGuard(() => player.setVolume(player.volume - 0.1)),
    },
    // The control room owns its own keys — radio shortcuts stay out of /admin.
    route === 'admin',
  );

  const requestOnAir = Boolean(
    activeRequest && player.stationId === requestStationId(activeRequest.id),
  );
  // Community Pick — one helper owns the honesty rules for pill, dock and wall.
  const pick = communityPick(activeRequest, hasVoted);
  const isCurrentTrack = Boolean(selected && player.stationId === selected.id) || requestOnAir;
  const canPlay = Boolean(selected && isPlayableDecision(decideSource(selected)));

  const playerState: PlayerState = !browserOnline
    ? 'offline'
    : player.status === 'error'
      ? 'error'
      : player.status === 'loading'
        ? 'buffering'
        : player.status === 'playing'
          ? 'playing'
          : player.status === 'paused'
            ? 'paused'
            : 'ready';

  // The pill always describes what is actually loaded or audible.
  const loadedStation = player.stationId ? findStation(player.stationId) ?? null : null;
  const audible = player.status === 'playing' || player.status === 'loading';
  const playerStation = !loadedStation ? selected : audible ? loadedStation : selected;

  // Provider stations keep their official iframe visible above the pill.
  const dockProvider =
    player.engine === 'youtube' || player.engine === 'spotify' ? player.engine : null;

  // The control room replaces the whole public shell: no navbar, no player
  // chrome, no public shortcuts. Its chunk loads only on this route.
  if (route === 'admin') {
    if (adminLoadFailed) {
      return (
        <div className="admin-root" role="alert">
          <p className="admin-boot">The control room could not load. Reload the page to try again.</p>
        </div>
      );
    }
    const Admin = adminModule?.default;
    return (
      <div className="admin-root">
        {Admin ? (
          <Admin />
        ) : (
          <p className="admin-boot" role="status">
            Opening the control room…
          </p>
        )}
      </div>
    );
  }

  const shellStyle = {
    '--accent': selected ? stationAccent(selected) : undefined,
  } as CSSProperties;

  return (
    <div className="shell grain" style={shellStyle}>
      <HomeNav
        compact={compact}
        route={route}
        onNavigate={navigate}
        onSearch={openSearch}
        onHelp={() => setHelpOpen(true)}
      />

      {route === 'suggest' ? (
        <SuggestPage
          station={selected}
          onNotify={notify}
          activeRequestId={activeRequest?.id ?? null}
          onPlayRequest={startRequest}
          onMaybeAir={maybeAir}
        />
      ) : (
        <main>
          <CinematicHero
            station={selected}
            playerState={playerState}
            isCurrentTrack={isCurrentTrack}
            activeCategory={category}
            listeners={listeners}
            onPrimary={() => {
              if (!selected) return;
              // CTA reads "Pause" while this station is audible — toggle, don't restart.
              if (isCurrentTrack && (playerState === 'playing' || playerState === 'buffering')) {
                void togglePlay();
              } else {
                handlePrimary(selected);
              }
            }}
            onShare={() => void share(selected)}
            onInfo={() => setInfoOpen(true)}
            onSurprise={surprise}
            onSelectCategory={selectCategory}
            onExploreAll={openSearch}
          />
        </main>
      )}

      {/* Participate controls sit beside the player — never inside it. */}
      <CommunityControls
        station={selected}
        onSuggest={() => navigate(suggestHref())}
      />

      <FloatingPlayer
        station={playerStation}
        playerState={playerState}
        isCurrentTrack={
          Boolean(playerStation && player.stationId === playerStation.id) || requestOnAir
        }
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        muted={player.muted}
        canPlay={canPlay}
        provider={dockProvider}
        trackTitle={activeRequest ? activeRequest.title : player.trackTitle}
        contextLabel={pick.label}
        contextVotes={pick.votes}
        contextHelped={pick.helped}
        hasVolume={player.hasVolume}
        expanded={playerExpanded}
        minimized={playerMinimized}
        queue={pool}
        onToggleExpand={() => setPlayerExpanded((value) => !value)}
        onToggleMinimize={() => setPlayerMinimized((value) => !value)}
        onPrevious={() => stepRef.current(-1)}
        onNext={() =>
          activeRequestRef.current ? advanceRef.current('manual') : stepRef.current(1)
        }
        onTogglePlay={() => void togglePlay()}
        onVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onSeek={player.seek}
        onPick={handleSelect}
      />

      {dockProvider && playerStation ? (
        <EngineDock
          manager={getPlayerManager()}
          provider={dockProvider}
          trackTitle={player.trackTitle}
          stationName={pick.label ?? playerStation.name}
        />
      ) : null}

      {searchOpen ? (
        <Suspense fallback={null}>
          <SearchOverlay
            open
            onClose={() => setSearchOpen(false)}
            onPick={handleSelect}
            onSurprise={surprise}
          />
        </Suspense>
      ) : null}

      <StationInfoModal
        station={infoOpen ? selected : null}
        onClose={() => setInfoOpen(false)}
        onShare={(station) => void share(station)}
        onOpenSource={openSource}
      />

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <Toast message={toast} />

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
