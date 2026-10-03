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
import { routeFromPathname, requestHrefFor, suggestHref } from '../lib/routes';
import type { RouteName } from '../lib/routes';
import { useBroadcast } from '../hooks/useBroadcast';
import { decisionForBroadcastTrack, trackSignature } from '../lib/broadcast';
import type { BroadcastScope } from '../lib/broadcast';
import { isSupabaseConfigured } from '../lib/supabase-env';
import {
  loadPlayback,
  loadTuning,
  markHasPlayed,
  saveMuted,
  saveTuning,
  saveVolume,
} from '../lib/player-prefs';

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

/**
 * Deep link first; otherwise this browser's own tuning; otherwise the MIX chip.
 * Restored state never plays anything — the Play button is the only gesture
 * that starts audio (and the flag it sets powers the welcome-back line).
 */
const initialState = (): {
  category: CategoryId;
  station: Station | null;
  scope: BroadcastScope;
  resumed: boolean;
} => {
  const linked = findStation(queryParam('station'));
  const fromUrl = queryParam('category');
  const stored = linked || fromUrl ? null : loadTuning();
  const category: CategoryId = linked
    ? linked.category
    : fromUrl && isCategoryId(fromUrl)
      ? fromUrl
      : stored && isCategoryId(stored.category)
        ? stored.category
        : 'mix';
  const station =
    linked ??
    (stored?.stationId ? findStation(stored.stationId) : null) ??
    findStation(CATEGORY_MAP[category]?.flagship) ??
    STATIONS[0] ??
    null;
  const scope: BroadcastScope = linked
    ? 'local'
    : stored?.scope === 'local'
      ? 'local'
      : isSupabaseConfigured()
        ? 'channel'
        : 'local';
  return { category, station, scope, resumed: !linked && stored !== null };
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
  // Where the one global player points: the shared channel, or a station the
  // listener tuned on purpose (it stays local until category switch or LIVE).
  const [scope, setScope] = useState<BroadcastScope>(initial.scope);

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

  /**
   * Not on air: the honest destination is Suggest Music with this station
   * pre-picked — in-app navigation, the same player, no dead external tab.
   */
  const goToRequest = useCallback(
    (station: Station) => {
      setCategory(station.category);
      setSelected(station);
      setAnnouncement(`${station.name} is not on air yet. Request a song for it.`);
      navigate(requestHrefFor(station.id));
      notify(`Not on air yet — suggest a song for ${station.name}.`);
    },
    [navigate, notify],
  );

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
  const boundaryRef = useRef<(origin: QueueOrigin) => void>(() => {});
  // Both engines land here: locally the old queue decides; on the live channel
  // the server's compare-and-swap owns the boundary.
  const player = useRadioPlayer({
    onEnded: (origin) => boundaryRef.current(origin ?? 'audio'),
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  // The shared broadcast for this category: one clock, one queue, one truth.
  const channel = useBroadcast(category);
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  /** Signature of the channel song the single global player currently holds. */
  const [loadedChannel, setLoadedChannel] = useState<string | null>(null);
  const loadedChannelRef = useRef<string | null>(null);
  const loadedStartedRef = useRef<string | null>(null);
  /** Pending join-seek target (seconds) — retried until the engine lands it. */
  const joinSeekRef = useRef<number | null>(null);
  const errorSkipRef = useRef<string | null>(null);
  const welcomeRef = useRef(false);

  // One trampoline for every track end: the live channel ends through the
  // server's CAS; a local tune keeps the legacy community-queue behaviour.
  boundaryRef.current = (origin) => {
    if (scopeRef.current === 'channel') {
      void channelRef.current.advance();
      return;
    }
    advanceRef.current(origin);
  };

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

  /**
   * A local tune: the listener pointed the player somewhere on purpose. The
   * channel keeps running for everyone else — this device leaves it until
   * the category changes or LIVE brings it back.
   */
  const retuneLocal = useCallback(() => {
    loadedChannelRef.current = null;
    loadedStartedRef.current = null;
    setLoadedChannel(null);
    setScope('local');
  }, []);

  const startStation = useCallback(
    async (station: Station) => {
      retuneLocal();
      updateActiveRequest(null);
      const decision = decideSource(station);
      if (!isPlayableDecision(decision)) {
        if (decision.kind === 'request') {
          goToRequest(station);
          return;
        }
        notify('This station opens on its own page — nothing plays here.');
        navigateSource(station);
        return;
      }
      if (playerRef.current.stationId !== station.id) {
        playerRef.current.load(station.id, decision);
      }
      await playerRef.current.play();
    },
    [notify, updateActiveRequest, goToRequest, retuneLocal],
  );

  /**
   * Joining the live channel: load what is on air and seek to the shared
   * position, so a late listener lands on the same second as everyone else.
   * Nothing here plays without a gesture — the caller decides that.
   */
  const joinChannel = useCallback(
    async (autoplay: boolean) => {
      const api = playerRef.current;
      const current = channelRef.current;
      const track = current.track;
      if (!track) {
        // The channel has not answered (yet): the honest fallback is the
        // selected station when it can actually play here — never a fake.
        const station = selected;
        const decision = station ? decideSource(station) : null;
        if (station && decision && isPlayableDecision(decision)) {
          await startStation(station);
        } else {
          notify('The live channel is not available right now — try again.');
        }
        return;
      }
      const signature = trackSignature(track);
      if (loadedChannelRef.current !== signature) {
        const decision = decisionForBroadcastTrack(track);
        if (!decision) {
          notify('The live channel is airing a source this player cannot reach — moving on.');
          void current.advance();
          return;
        }
        api.load(track.station_slug ?? `channel:${track.category_slug}`, decision);
        loadedChannelRef.current = signature;
        loadedStartedRef.current = track.started_at;
        setLoadedChannel(signature);
        api.seek(current.elapsed);
        joinSeekRef.current = current.elapsed;
      } else {
        // Same song, but possibly far behind after a pause: re-sync first.
        const drift = Math.abs(api.currentTime - current.elapsed);
        if (drift > 2) {
          api.seek(current.elapsed);
          joinSeekRef.current = current.elapsed;
        }
      }
      if (autoplay) await api.play();
    },
    [notify, selected, startStation],
  );

  const togglePlay = useCallback(async () => {
    const station = selected;
    const current = playerRef.current;
    if (scopeRef.current === 'channel') {
      if (current.status === 'playing') {
        current.pause(); // pausing hears nothing; the channel keeps airing
        return;
      }
      await joinChannel(true);
      return;
    }
    if (!station) return;
    const requestOnAir = activeRequestRef.current;
    if (requestOnAir && current.stationId === requestStationId(requestOnAir.id)) {
      // The request owns playback right now — pause it, don't restart the station.
      await current.toggle();
      return;
    }
    const decision = decideSource(station);
    if (!isPlayableDecision(decision)) {
      if (decision.kind === 'request') {
        goToRequest(station);
        return;
      }
      notify('This station opens on its own page — nothing plays here.');
      navigateSource(station);
      return;
    }
    if (current.stationId === station.id && current.isPlayable) await current.toggle();
    else await startStation(station);
  }, [selected, joinChannel, startStation, notify, goToRequest]);

  /**
   * The core interaction: a chip selects a station set and the hero switches to
   * that category's flagship — same page, same layout, no route change.
   * A category switch rejoins the shared channel: every category owns one.
   */
  const selectCategory = useCallback(
    (id: CategoryId) => {
      setCategory(id);
      setScope('channel');
      loadedChannelRef.current = null;
      loadedStartedRef.current = null;
      setLoadedChannel(null);
      const flagship = findStation(CATEGORY_MAP[id]?.flagship);
      if (!flagship) return;
      // Hero identity only — from here the channel owns the audio.
      goTo(flagship, false);
    },
    [goTo],
  );

  /** Back to live: drop the local tune and let the channel's effect load in. */
  const goLive = useCallback(() => {
    loadedChannelRef.current = null;
    loadedStartedRef.current = null;
    setLoadedChannel(null);
    setScope('channel');
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      retuneLocal(); // stepping stations leaves the live channel on purpose
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
    [pool, selected, goTo, retuneLocal],
  );

  /** One request = one official provider embed, loaded like any other source. */
  const playRequest = useCallback(
    async (request: SongRequest): Promise<boolean> => {
      if (activeRequestRef.current?.id === request.id) return true; // already on air
      retuneLocal(); // a preview is this device's own decision, not the channel's
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
    [notify, updateActiveRequest, retuneLocal],
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

  /**
   * The channel owns the global player while this device is live: every new
   * song (or fresh clock round of a looping one) is loaded and seeked to the
   * shared position. Autoplay only ever continues what is already audible —
   * a page that has never been played loads paused, awaiting its gesture.
   */
  const channelTrack = channel.track;
  useEffect(() => {
    if (scope !== 'channel') return;
    const track = channelRef.current.track;
    const api = playerRef.current;
    if (!track) return;
    const signature = trackSignature(track);

    if (loadedChannelRef.current === signature) {
      if (loadedStartedRef.current !== track.started_at) {
        // Same song, fresh clock — the programme looped; snap to its start.
        loadedStartedRef.current = track.started_at;
        api.seek(channelRef.current.elapsed);
        joinSeekRef.current = channelRef.current.elapsed;
      }
      return;
    }

    const wasPlaying = api.status === 'playing' || api.status === 'loading';
    const decision = decisionForBroadcastTrack(track);
    loadedChannelRef.current = signature;
    loadedStartedRef.current = track.started_at;
    setLoadedChannel(signature);
    updateActiveRequest(null); // the channel, not a preview, describes playback now

    if (!decision) {
      // Honest refusal: no source or failed validation — skip past it.
      notify('The live channel is airing a source this player cannot reach — moving on.');
      void channelRef.current.advance();
      return;
    }
    api.load(track.station_slug ?? `channel:${track.category_slug}`, decision);
    api.seek(channelRef.current.elapsed);
    joinSeekRef.current = channelRef.current.elapsed;
    if (wasPlaying) void api.play();
  }, [scope, channelTrack, notify, updateActiveRequest]);

  // Join-seek is retried until the engine actually lands there (embeds spawn
  // their iframe asynchronously; a fresh audio element needs its metadata).
  useEffect(() => {
    const target = joinSeekRef.current;
    if (target === null) return;
    const api = playerRef.current;
    if (api.status === 'idle' || api.status === 'error') {
      joinSeekRef.current = null;
      return;
    }
    if (Math.abs(api.currentTime - target) <= 2) {
      joinSeekRef.current = null;
      return;
    }
    api.seek(target);
  }, [channel.elapsed, scope]);

  // A source that will not play is skipped honestly — one attempt per track,
  // and never while the browser itself is offline (that would churn the queue).
  useEffect(() => {
    if (scope !== 'channel' || !browserOnline) return;
    const track = channelRef.current.track;
    if (!track || player.status !== 'error') return;
    const signature = trackSignature(track);
    if (errorSkipRef.current === signature) return;
    errorSkipRef.current = signature;
    notify('This track could not play — skipping to the next on the channel.');
    void channelRef.current.advance();
  }, [scope, browserOnline, channel.track, player.status, notify]);

  // What this listener chose last time — local to this browser, never sent
  // anywhere. The first real playback marks the session for next visit's line.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    saveTuning({ category, stationId: selected?.id ?? null, scope });
  }, [category, selected, scope]);

  useEffect(() => {
    saveVolume(player.volume);
  }, [player.volume]);
  useEffect(() => {
    saveMuted(player.muted);
  }, [player.muted]);

  useEffect(() => {
    if (player.status === 'playing') markHasPlayed();
  }, [player.status]);

  // Restore the preference exactly once, before anything could autoplay.
  useEffect(() => {
    const prefs = loadPlayback();
    if (prefs.volume !== null) playerRef.current.setVolume(prefs.volume);
    if (prefs.muted && !playerRef.current.muted) playerRef.current.toggleMute();
    if (initial.resumed && prefs.hasPlayed && !welcomeRef.current) {
      welcomeRef.current = true;
      const label = initial.station ? ` to resume ${initial.station.name}` : '';
      const timer = window.setTimeout(() => {
        notify(`Welcome back — press Play${label}.`);
      }, 500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time restore
  }, []);

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
    // No duration to seek: stations step only while locally tuned — the live
    // channel has no "next" for one listener to force on everyone.
    if (scopeRef.current === 'channel') return;
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
      } else if (decision.kind === 'request') {
        goToRequest(station);
      } else {
        navigateSource(station);
        notify(
          decision.kind === 'check'
            ? 'Opening the station page to check availability.'
            : 'Source could not be validated.',
        );
      }
    },
    [goTo, startStation, notify, goToRequest],
  );

  const openSource = useCallback(
    (station: Station) => {
      if (decideSource(station).kind === 'request') {
        goToRequest(station);
        return;
      }
      const ok = navigateSource(station);
      notify(ok ? 'Opened in a new tab.' : 'This source failed validation and was not opened.');
    },
    [notify, goToRequest],
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
  // The wall's "on air" badge follows the shared channel — site-wide truth,
  // whatever this particular device happens to be tuned to right now.
  const onAirSuggestionId =
    channel.track?.track_kind === 'suggestion' ? channel.track.track_key : null;
  const activeRequestId = onAirSuggestionId ?? activeRequest?.id ?? null;

  // Community Pick — one helper owns the honesty rules for pill, dock and wall.
  const pick =
    scope === 'channel'
      ? communityPick(
          channel.track?.track_kind === 'suggestion'
            ? { id: channel.track.track_key, votes: channel.track.votes ?? 0 }
            : null,
          hasVoted,
        )
      : communityPick(activeRequest, hasVoted);
  const isCurrentTrack =
    scope === 'channel'
      ? Boolean(channel.track && loadedChannel === trackSignature(channel.track))
      : Boolean(selected && player.stationId === selected.id) || requestOnAir;
  const canPlay =
    scope === 'channel' && channel.track
      ? decisionForBroadcastTrack(channel.track) !== null
      : Boolean(selected && isPlayableDecision(decideSource(selected)));

  // The pill title: the channel's song while live; the preview or the
  // provider-reported title while this device is tuned locally.
  const pillTitle =
    scope === 'channel'
      ? (player.trackTitle ?? channel.track?.title ?? null)
      : activeRequest
        ? activeRequest.title
        : player.trackTitle;

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
          activeRequestId={activeRequestId}
          onPlayRequest={startRequest}
          channel={
            channel.track
              ? {
                  title: channel.track.title,
                  subtitle: channel.track.subtitle,
                  votes: channel.track.votes ?? null,
                  elapsed: channel.elapsed,
                }
              : null
          }
          onListenLive={() => {
            goLive();
            navigate('/');
            void joinChannel(true);
          }}
        />
      ) : (
        <main>
          <CinematicHero
            station={selected}
            playerState={playerState}
            isCurrentTrack={isCurrentTrack}
            activeCategory={category}
            listeners={listeners}
            primaryLabel={
              scope === 'channel' && channel.track
                ? isCurrentTrack && (playerState === 'playing' || playerState === 'buffering')
                  ? 'Pause'
                  : 'Listen live'
                : undefined
            }
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
          scope === 'channel'
            ? isCurrentTrack
            : Boolean(playerStation && player.stationId === playerStation.id) || requestOnAir
        }
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        muted={player.muted}
        canPlay={canPlay}
        provider={dockProvider}
        trackTitle={pillTitle}
        contextLabel={pick.label}
        contextVotes={pick.votes}
        contextHelped={pick.helped}
        hasVolume={player.hasVolume}
        expanded={playerExpanded}
        minimized={playerMinimized}
        queue={pool}
        liveScope={scope === 'channel'}
        artwork={scope === 'channel' ? channel.track?.artwork_url ?? null : null}
        upcoming={
          scope === 'channel'
            ? channel.upcoming.map((item) => ({
                key: item.key,
                title: item.title,
                subtitle: item.subtitle ?? null,
                artwork: item.artwork ?? null,
                votes: item.votes ?? null,
              }))
            : null
        }
        onGoLive={scope === 'local' && channel.track ? goLive : null}
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
