import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';

import { isCategoryId } from '../data/categories';
import type { CategoryId, Station } from '../types/station';

import { findStation, randomStation, stationsForCategory } from '../lib/catalog';
import {
  decideSource,
  embedSourceForRequest,
  isPlayableDecision,
  navigateSource,
} from '../lib/sourcePolicy';
import {
  bundledProgramme,
  decisionForProgrammeSong,
  getCatalogue,
  getCategory,
  getSetting,
  loadProgramme,
  pickProgrammeNext,
  programmeIndexFor,
} from '../lib/live-catalogue';
import type { ProgrammeSong } from '../lib/live-catalogue';
import { requestStationId } from '../lib/queue';
import type { QueueOrigin } from '../lib/queue';
import type { SongRequest } from '../lib/request-api';
import { shareStation } from '../lib/share';
import { stationAccent } from '../lib/hero';

import { useRadioPlayer } from '../hooks/useRadioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePresence } from '../hooks/usePresence';
import { useLiveCatalogue } from '../hooks/useLiveCatalogue';
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
    findStation(getCategory(category)?.flagship) ??
    getCatalogue().stations[0] ??
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
  const updateActiveRequest = useCallback((request: SongRequest | null) => {
    activeRequestRef.current = request;
    setActiveRequestState(request);
  }, []);

  // The station's programme — the songs mapped to it (seed rows first, the
  // live admin catalogue after hydration). It runs by itself: one selection,
  // continuous audio, no manual effort.
  const [programme, setProgramme] = useState<ProgrammeSong[]>([]);
  const programmeRef = useRef<ProgrammeSong[]>(programme);
  programmeRef.current = programme;
  /** Which mapped song the local player holds; null = the station's own source. */
  const [currentSong, setCurrentSong] = useState<ProgrammeSong | null>(null);
  const currentSongRef = useRef<ProgrammeSong | null>(null);
  currentSongRef.current = currentSong;
  /** What the single global player holds while this device is tuned locally. */
  const loadedLocalRef = useRef<{ kind: 'station' | 'song' | 'preview'; stationId: string }>({
    kind: 'station',
    stationId: '',
  });
  /** Song position a request preview interrupted — resumed when it ends. */
  const previewResumeRef = useRef<ProgrammeSong | null>(null);
  /** Consecutive local playback failures — three stop the loop honestly. */
  const localErrorsRef = useRef(0);
  /** De-duplicates the local error effect per failed source. */
  const localErrorSeenRef = useRef<string | null>(null);
  /** A category chip asked for autoplay: the new channel/flagship starts itself. */
  const autoplayOnJoinRef = useRef(false);
  /** startStation reached from goTo's autoplay branch (goTo is defined first). */
  const startStationRef = useRef<(station: Station) => Promise<void>>(async () => {});

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

  // The live catalogue (admin edits converge here) — bumping `version` re-
  // renders the whole shell: hero, gallery, search, player, nav.
  const catalogue = useLiveCatalogue();

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

  const pool = useMemo(() => {
    void catalogue.version; // re-derive when the live catalogue hydrates/edits
    return stationsForCategory(category);
  }, [category, catalogue.version]);

  // After hydration the selected Station object may have been updated (an
  // admin edit) or dropped (deactivated) — re-resolve it from the snapshot.
  useEffect(() => {
    if (!selected) return;
    const fresh = findStation(selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [selected, catalogue.version]);

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
        // Selecting a station starts it: the press itself is the gesture.
        void startStationRef.current(station);
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
      // Re-selecting the station already loaded keeps its position; a new
      // station starts from its own source and programme head.
      if (playerRef.current.stationId !== station.id) {
        loadedLocalRef.current = { kind: 'station', stationId: station.id };
        setCurrentSong(null);
        currentSongRef.current = null;
        localErrorsRef.current = 0;
        playerRef.current.load(station.id, decision);
        // Instant programme from the bundled rows; the effect below upgrades
        // it to the live rows (and keeps it fresh across admin edits).
        setProgramme(bundledProgramme(station.id));
      }
      try {
        await playerRef.current.play();
      } catch {
        // The browser wants a gesture first — honest paused state, never a
        // fake "playing" indicator.
      }
      previewResumeRef.current = null;
    },
    [notify, updateActiveRequest, goToRequest, retuneLocal],
  );
  startStationRef.current = startStation;

  // The selected station's programme: this station's bundled rows instantly,
  // then the live admin rows — refetched whenever the catalogue itself
  // changes. The live-flag guards a slow answer from overwriting a newer
  // station's list.
  useEffect(() => {
    if (!selected) return;
    const id = selected.id;
    setProgramme(bundledProgramme(id));
    let live = true;
    void loadProgramme(id).then((songs) => {
      if (live) setProgramme(songs);
    });
    return () => {
      live = false;
    };
  }, [selected, catalogue.version]);

  // Public site_settings are live: title and meta description follow them the
  // moment hydration (or a realtime edit) brings them in. index.html keeps the
  // honest static defaults for anything the admin has not set.
  const docDefaults = useRef<{ title: string; description: string } | null>(null);
  useEffect(() => {
    docDefaults.current ??= {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    };
    const base = docDefaults.current;
    const name = getSetting('site_name')?.trim();
    const seoTitle = getSetting('seo_title')?.trim();
    const description =
      getSetting('seo_description')?.trim() || getSetting('site_description')?.trim();
    document.title =
      seoTitle || (name ? `${name} — Old roads, local radios, songs that never left` : base.title);
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', description || base.description);
  }, [catalogue.version]);

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
      const flagship = findStation(getCategory(id)?.flagship);
      if (!flagship) return;
      // Hero identity only — from here the channel owns the audio.
      goTo(flagship, false);
      // Pressing a chip is a gesture: the new channel (or the flagship when
      // the channel cannot answer) starts itself — no second press needed.
      autoplayOnJoinRef.current = true;
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
      const list = pool.length > 0 ? pool : getCatalogue().stations;
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
      // Selecting a station starts it — the press itself is the gesture
      // (browsers allow playback right after a user interaction).
      goTo(target, true);
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
      const previousLocal = loadedLocalRef.current;
      previewResumeRef.current = currentSongRef.current;
      loadedLocalRef.current = { kind: 'preview', stationId: requestStationId(request.id) };
      updateActiveRequest(request);
      try {
        playerRef.current.load(requestStationId(request.id), { kind: 'embed', source });
        await playerRef.current.play();
      } catch {
        // Engine refused (blocked autoplay, dead iframe…) — it never aired, so it
        // stays open and the pill returns to the station instead of a stuck title.
        updateActiveRequest(null);
        loadedLocalRef.current = previousLocal;
        previewResumeRef.current = null;
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
   * The station's own source, loaded fresh: the loop after a single-sample
   * station, the hand-back after a preview, the playlist restart at rest.
   */
  const reloadStationSource = useCallback(async (station: Station): Promise<boolean> => {
    const decision = decideSource(station);
    if (!isPlayableDecision(decision)) return false;
    loadedLocalRef.current = { kind: 'station', stationId: station.id };
    setCurrentSong(null);
    currentSongRef.current = null;
    const api = playerRef.current;
    api.load(station.id, decision);
    try {
      await api.play();
    } catch {
      /* no gesture / blocked autoplay — honest paused state */
    }
    return true;
  }, []);

  /** One mapped song, loaded exactly like any other local source. */
  const playProgrammeSong = useCallback(
    async (station: Station, song: ProgrammeSong): Promise<boolean> => {
      const decision = decisionForProgrammeSong(song);
      if (!decision) return false; // no playable pointer → the walker skips it
      loadedLocalRef.current = { kind: 'song', stationId: station.id };
      setCurrentSong(song);
      currentSongRef.current = song;
      const api = playerRef.current;
      api.load(station.id, decision);
      try {
        await api.play();
      } catch {
        return false;
      }
      setAnnouncement(
        `Now playing ${song.title}${song.artist ? ` by ${song.artist}` : ''} — ${station.name}.`,
      );
      return true;
    },
    [],
  );

  /**
   * What airs at a local boundary: the station's mapped programme runs by
   * itself — one selection, continuous audio, no manual effort and no silent
   * station-hopping. A request preview hands the air back (previews never
   * retire a community request — the channel's scheduler owns that). A
   * provider playlist advances videos on its own; we only restart it when it
   * truly rests at its end.
   */
  const advanceLocal = useCallback(
    async (origin: QueueOrigin) => {
      if (activeRequestRef.current) updateActiveRequest(null);
      const station = selected;
      if (!station) return;
      const loaded = loadedLocalRef.current;

      // Preview over → continue the station's programme where it stood.
      if (loaded.kind === 'preview') {
        const songs = programmeRef.current;
        const base = programmeIndexFor(songs, previewResumeRef.current, station.audioUrl ?? null);
        previewResumeRef.current = null;
        const next = pickProgrammeNext(songs, base, 1);
        if (next && (await playProgrammeSong(station, next))) return;
        await reloadStationSource(station);
        return;
      }

      // The provider reported a boundary. A new video means it is already
      // playing the next one; a genuine rest restarts the playlist so the
      // station never goes silent.
      if (loaded.kind === 'station' && origin === 'station-embed') {
        window.setTimeout(() => {
          if (scopeRef.current !== 'local') return;
          if (loadedLocalRef.current.kind !== 'station') return;
          if (loadedLocalRef.current.stationId !== station.id) return;
          const status = getPlayerManager().getState().status;
          if (status === 'playing' || status === 'loading') return; // next video came on
          void reloadStationSource(station);
        }, 2500);
        return;
      }

      // A mapped song (or the station's own direct audio) ended: walk the
      // programme from the current position, wrapping once, skipping rows
      // with no playable source — then fall back to the station source.
      const songs = programmeRef.current;
      const currentIndex = programmeIndexFor(
        songs,
        currentSongRef.current,
        loaded.kind === 'station' ? station.audioUrl ?? null : null,
      );
      if (songs.length > 0) {
        for (let offset = 1; offset <= songs.length; offset += 1) {
          const next = songs[(Math.max(currentIndex, -1) + offset + songs.length * 2) % songs.length];
          if (next && (await playProgrammeSong(station, next))) return;
        }
      }
      await reloadStationSource(station);
    },
    [selected, updateActiveRequest, playProgrammeSong, reloadStationSource],
  );

  /**
   * Transport next/prev: walk THIS station's mapped programme. Stations on a
   * provider playlist (or with nothing mapped) keep stepping between stations
   * — the provider owns its own sequence.
   */
  const stepProgramme = useCallback(
    async (direction: 1 | -1) => {
      const station = selected;
      const decision = station ? decideSource(station) : null;
      if (!station || !decision || decision.kind !== 'play') {
        if (activeRequestRef.current) updateActiveRequest(null);
        stepRef.current(direction);
        return;
      }
      const wasPreview =
        loadedLocalRef.current.kind === 'preview' || Boolean(activeRequestRef.current);
      if (activeRequestRef.current) updateActiveRequest(null);
      const songs =
        programmeRef.current.length > 0 ? programmeRef.current : bundledProgramme(station.id);
      const base = programmeIndexFor(
        songs,
        wasPreview ? previewResumeRef.current : currentSongRef.current,
        station.audioUrl ?? null,
      );
      previewResumeRef.current = null;
      if (songs.length > 0) {
        const target = songs[(base + direction + songs.length) % songs.length];
        if (target && (await playProgrammeSong(station, target))) return;
      }
      await reloadStationSource(station);
    },
    [selected, updateActiveRequest, playProgrammeSong, reloadStationSource],
  );

  stepRef.current = step;
  advanceRef.current = advanceLocal;

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
    // Autoplay only continues what is already audible — unless a chip press
    // explicitly asked for this channel to start (one gesture, one start).
    if (wasPlaying || autoplayOnJoinRef.current) {
      autoplayOnJoinRef.current = false;
      void api.play().catch(() => undefined);
    }
  }, [scope, channelTrack, notify, updateActiveRequest]);

  // A chip asked for autoplay: the channel track plays through the effect
  // above. When the channel cannot answer (unconfigured, offline, empty) the
  // flagship starts locally instead — one gesture always starts audio, never
  // a silent hero.
  useEffect(() => {
    if (!autoplayOnJoinRef.current) return;
    if (scope !== 'channel') {
      autoplayOnJoinRef.current = false;
      return;
    }
    if (channel.track) return; // the effect above loads and plays it
    const answered = channel.joined || channel.unavailable;
    if (isSupabaseConfigured() && !answered) return; // still connecting
    autoplayOnJoinRef.current = false;
    const flagship = selected;
    if (!flagship) return;
    const decision = decideSource(flagship);
    if (isPlayableDecision(decision)) {
      void startStation(flagship);
    } else {
      notify('The live channel is not available right now — press Play to try again.');
    }
  }, [scope, channel.track, channel.joined, channel.unavailable, selected, startStation, notify]);

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

  // A local source that will not play: previews hand the air back to the
  // station, mapped songs advance to the next — and three straight failures
  // stop the loop honestly instead of churning. The live channel has its own
  // one-attempt skip (above) and never runs through here.
  useEffect(() => {
    if (scope === 'channel') return;
    if (player.status !== 'error') {
      localErrorSeenRef.current = null;
      return;
    }
    if (!browserOnline) return; // offline is not a source's fault — never churn
    const loaded = loadedLocalRef.current;
    const seenKey = `${loaded.kind}:${loaded.stationId}:${currentSong?.id ?? ''}`;
    if (localErrorSeenRef.current === seenKey) return;
    localErrorSeenRef.current = seenKey;

    if (loaded.kind === 'preview' || activeRequestRef.current) {
      void advanceLocal('error'); // never aired → the request simply stays open
      return;
    }
    localErrorsRef.current += 1;
    if (localErrorsRef.current >= 3) {
      localErrorsRef.current = 0;
      notify('This station could not play — check your connection, then press Play to retry.');
      return;
    }
    void advanceLocal('error');
  }, [scope, browserOnline, player.status, currentSong, activeRequest, advanceLocal, notify]);

  // Real audio coming back clears the local failure tally.
  useEffect(() => {
    if (player.status === 'playing') localErrorsRef.current = 0;
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
      // The picked station IS the one now on air: hero, pill and — crucially
      // — the programme that auto-advances must all follow it.
      setSelected(station);
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

  // The pill title: the channel's song while live; the preview, the mapped
  // programme song or the provider-reported title while tuned locally.
  const pillTitle =
    scope === 'channel'
      ? (player.trackTitle ?? channel.track?.title ?? null)
      : activeRequest
        ? activeRequest.title
        : currentSong?.title ?? player.trackTitle;

  // The player queue: the channel's votes-ordered list while live; this
  // station's own programme while tuned locally (direct-audio stations only —
  // a provider playlist sequences itself and shows nothing to invent).
  const localUpcoming =
    scope === 'channel' || !selected || programme.length === 0
      ? null
      : decideSource(selected).kind !== 'play'
        ? null
        : programme
            .filter(
              (_, index) =>
                index !==
                programmeIndexFor(programme, currentSong, selected.audioUrl ?? null),
            )
            .map((song) => ({
              key: song.id,
              title: song.title,
              subtitle: song.artist ?? 'Station programme',
              artwork: song.artwork ?? null,
              votes: null,
            }));

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

  // Live maintenance switch: `maintenance_mode` takes the public shell down
  // the moment an admin flips it (site_settings hydrate + realtime), while
  // the control room above stays reachable. Default false — this branch never
  // renders until someone turns it on.
  if (getSetting('maintenance_mode') === 'true') {
    return (
      <div className="shell grain maintenance" role="alert">
        <main className="maintenance-card">
          <p className="eyebrow">{getSetting('site_name')?.trim() || 'Nostalgia Radio'}</p>
          <h1 className="hero-title">Back on air shortly.</h1>
          <p className="hero-description">
            The station is tuning up for the next set. Nothing has been lost — the programme
            resumes as soon as the doors open.
          </p>
        </main>
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
            : localUpcoming
        }
        upcomingLabel={
          scope === 'channel' ? 'Up next on air · by votes' : 'Up next in this station'
        }
        onGoLive={scope === 'local' && channel.track ? goLive : null}
        onToggleExpand={() => setPlayerExpanded((value) => !value)}
        onToggleMinimize={() => setPlayerMinimized((value) => !value)}
        onPrevious={() => void stepProgramme(-1)}
        onNext={() => void stepProgramme(1)}
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
