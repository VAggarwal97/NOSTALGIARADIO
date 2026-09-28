import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { CATEGORY_MAP, isCategoryId } from '../data/categories';
import { STATIONS } from '../data/stations';
import type { CategoryId, Station } from '../types/station';

import { findStation, randomStation, stationsForCategory } from '../lib/catalog';
import { audioUrlFor, decideSource, navigateSource } from '../lib/sourcePolicy';
import { shareStation } from '../lib/share';
import { stationAccent } from '../lib/hero';

import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

import { TopNav } from '../components/TopNav';
import { CinematicHero } from '../components/CinematicHero';
import type { PlayerState } from '../components/CinematicHero';
import { FloatingPlayer } from '../components/FloatingPlayer';
import { SearchOverlay } from '../components/SearchOverlay';
import { StationInfoModal } from '../components/StationInfoModal';
import { HelpOverlay } from '../components/HelpOverlay';
import { Toast } from '../components/Toast';

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

  // The header tightens after the first scroll — same shell, smaller footprint.
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 48);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
  // latest `step` without re-creating the audio element.
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});
  const advanceRef = useRef<(direction: 1 | -1) => void>(() => {});
  const player = useAudioPlayer({ onEnded: () => advanceRef.current(1) });
  const playerRef = useRef(player);
  playerRef.current = player;

  const pool = useMemo(() => stationsForCategory(category), [category]);

  const goTo = useCallback((station: Station, autoplay = false) => {
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

    if (autoplay) {
      const audioUrl = audioUrlFor(station);
      if (audioUrl) {
        playerRef.current.load(station.id, audioUrl);
        void playerRef.current.play();
      }
    }
  }, []);

  const startStation = useCallback(
    async (station: Station) => {
      const audioUrl = audioUrlFor(station);
      if (!audioUrl) {
        notify('This station opens on its own page — nothing plays here.');
        navigateSource(station);
        return;
      }
      if (playerRef.current.stationId !== station.id) playerRef.current.load(station.id, audioUrl);
      await playerRef.current.play();
    },
    [notify],
  );

  const togglePlay = useCallback(async () => {
    const station = selected;
    if (!station) return;
    const audioUrl = audioUrlFor(station);
    if (!audioUrl) {
      notify('This station opens on its own page — nothing plays here.');
      navigateSource(station);
      return;
    }
    const current = playerRef.current;
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
      goTo(flagship, keepListening && decideSource(flagship).kind === 'play');
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

  stepRef.current = step;
  advanceRef.current = step;

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
      if (decision.kind === 'play') {
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

  useKeyboardShortcuts({
    togglePlay: () => void togglePlay(),
    previous: () => stepOrSeek(-1),
    next: () => stepOrSeek(1),
    toggleMute: player.toggleMute,
    openSearch,
    toggleHelp: () => {
      setInfoOpen(false);
      setSearchOpen(false);
      setHelpOpen((open) => !open);
    },
    share: () => void share(selected),
    surprise,
    closeOverlays,
    volumeUp: () => player.setVolume(player.volume + 0.1),
    volumeDown: () => player.setVolume(player.volume - 0.1),
  });

  const isCurrentTrack = Boolean(selected && player.stationId === selected.id);
  const canPlay = Boolean(selected && decideSource(selected).kind === 'play');

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

  const serviceLinks = (selected?.externalLinks ?? []).filter((link) =>
    /spotify|youtube/i.test(link.label),
  );

  const shellStyle = {
    '--accent': selected ? stationAccent(selected) : undefined,
  } as CSSProperties;

  return (
    <div className="shell grain" style={shellStyle}>
      <TopNav
        activeCategory={category}
        compact={compact}
        serviceLinks={serviceLinks}
        onSelectCategory={selectCategory}
        onOpenSearch={openSearch}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main>
        <CinematicHero
          station={selected}
          playerState={playerState}
          isCurrentTrack={isCurrentTrack}
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
        />
      </main>

      <FloatingPlayer
        station={playerStation}
        playerState={playerState}
        isCurrentTrack={Boolean(playerStation && player.stationId === playerStation.id)}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        muted={player.muted}
        canPlay={canPlay}
        expanded={playerExpanded}
        minimized={playerMinimized}
        queue={pool}
        onToggleExpand={() => setPlayerExpanded((value) => !value)}
        onToggleMinimize={() => setPlayerMinimized((value) => !value)}
        onPrevious={() => stepRef.current(-1)}
        onNext={() => stepRef.current(1)}
        onTogglePlay={() => void togglePlay()}
        onVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onSeek={player.seek}
        onPick={handleSelect}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={handleSelect}
        onSurprise={surprise}
      />

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
