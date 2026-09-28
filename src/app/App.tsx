import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CATEGORIES, CATEGORY_MAP, isCategoryId } from '../data/categories';
import { EDITORIAL_MOMENTS } from '../data/editorial';
import { FEATURED_STATIONS, STATIONS } from '../data/stations';
import type { CategoryId, Station } from '../types/station';

import { findStation, randomStation, stationsForCategory } from '../lib/catalog';
import { audioUrlFor, decideSource, navigateSource } from '../lib/sourcePolicy';
import { shareStation } from '../lib/share';

import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useFavorites } from '../hooks/useFavorites';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

import { TopNav } from '../components/TopNav';
import { CategoryNav } from '../components/CategoryNav';
import { CinematicHero } from '../components/CinematicHero';
import type { PlayerState } from '../components/CinematicHero';
import { FloatingPlayer } from '../components/FloatingPlayer';
import { StationRail } from '../components/StationRail';
import { EditorialMoment } from '../components/EditorialMoment';
import { SiteFooter } from '../components/SiteFooter';
import { SearchOverlay } from '../components/SearchOverlay';
import { StationInfoModal } from '../components/StationInfoModal';
import { Toast } from '../components/Toast';

const queryParam = (name: string): string | null =>
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get(name);

export default function App() {
  const [category, setCategory] = useState<CategoryId>(() => {
    const fromUrl = queryParam('category');
    if (fromUrl && isCategoryId(fromUrl)) return fromUrl;
    const linked = findStation(queryParam('station'));
    return linked ? linked.category : 'mix';
  });

  const [selected, setSelected] = useState<Station | null>(
    () => findStation(queryParam('station')) ?? FEATURED_STATIONS[0] ?? STATIONS[0] ?? null,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [compact, setCompact] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const favorites = useFavorites();
  const toastTimer = useRef<number | null>(null);

  // Sticky header tightens after the first scroll — same shell, smaller footprint.
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
  // latest `advance` without re-creating the audio element.
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

  const handleSelect = useCallback(
    (station: Station) => {
      goTo(station);
      const decision = decideSource(station);
      if (decision.kind === 'play') playerRef.current.load(station.id, decision.audioUrl);
    },
    [goTo],
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

  const toggleFavorite = useCallback(
    (station: Station | null) => {
      if (!station) return;
      const wasSaved = favorites.has(station.id);
      favorites.toggle(station.id);
      notify(wasSaved ? 'Removed from my stations.' : 'Saved to my stations on this device.');
    },
    [favorites, notify],
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
    goTo(station, true);
    notify(`Surprise: ${station.name}`);
  }, [selected, goTo, notify]);

  const openSearch = useCallback(() => {
    setFavoritesOpen(false);
    setSearchOpen(true);
  }, []);

  const closeOverlays = useCallback(() => {
    setSearchOpen(false);
    setFavoritesOpen(false);
    setInfoOpen(false);
  }, []);

  const isCurrentTrack = Boolean(selected && player.stationId === selected.id);
  const canPlay = Boolean(selected && decideSource(selected).kind === 'play');
  const playingId = player.status === 'playing' ? player.stationId : null;

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

  useKeyboardShortcuts({
    togglePlay: () => void togglePlay(),
    previous: () => stepRef.current(-1),
    next: () => stepRef.current(1),
    toggleMute: player.toggleMute,
    openSearch,
    toggleFavorite: () => toggleFavorite(selected),
    share: () => void share(selected),
    surprise,
    closeOverlays,
    volumeUp: () => player.setVolume(player.volume + 0.1),
    volumeDown: () => player.setVolume(player.volume - 0.1),
  });

  const categoryMeta = CATEGORY_MAP[category];
  const isMix = category === 'mix';
  const collection = isMix ? STATIONS : pool;
  const featured = FEATURED_STATIONS;

  const railTitle = isMix ? 'The whole archive' : (categoryMeta?.label ?? 'Stations');
  const railNote = isMix ? `${STATIONS.length} stations` : categoryMeta?.tagline;

  return (
    <div className="shell grain">
      <TopNav
        nav={<CategoryNav active={category} onSelect={setCategory} />}
        compact={compact}
        favoriteCount={favorites.count}
        onOpenSearch={openSearch}
        onOpenFavorites={() => {
          setSearchOpen(false);
          setFavoritesOpen(true);
        }}
        onSurprise={surprise}
      />

      <main>
        <CinematicHero
          station={selected}
          playerState={playerState}
          isCurrentTrack={isCurrentTrack}
          onPrimary={() => void togglePlay()}
          onShare={() => void share(selected)}
          onInfo={() => setInfoOpen(true)}
        />

        <div className="page">
          <StationRail
            id="featured"
            title="Featured picks"
            note="One from every corner"
            stations={featured}
            selectedId={selected?.id ?? null}
            playingId={playingId}
            emptyMessage="No featured stations yet."
            onSelect={handleSelect}
            onPrimary={handlePrimary}
          />

          <EditorialMoment moment={EDITORIAL_MOMENTS.tonights} />

          <StationRail
            id="collection"
            key={category}
            title={railTitle}
            note={railNote}
            stations={collection}
            selectedId={selected?.id ?? null}
            playingId={playingId}
            emptyMessage="Nothing in this category yet — try another one above."
            onSelect={handleSelect}
            onPrimary={handlePrimary}
          />

          <EditorialMoment
            moment={EDITORIAL_MOMENTS[category] ?? EDITORIAL_MOMENTS.default}
          />
        </div>
      </main>

      <SiteFooter onOpenSearch={openSearch} />

      <FloatingPlayer
        station={selected}
        playerState={playerState}
        isCurrentTrack={isCurrentTrack}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        muted={player.muted}
        canPlay={canPlay}
        expanded={playerExpanded}
        onToggleExpand={() => setPlayerExpanded((value) => !value)}
        onPrevious={() => stepRef.current(-1)}
        onNext={() => stepRef.current(1)}
        onTogglePlay={() => void togglePlay()}
        onVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onSeek={player.seek}
        onOpenSource={openSource}
      />

      <SearchOverlay
        open={searchOpen}
        showFavorites={false}
        favorites={favorites.stations}
        onClose={() => setSearchOpen(false)}
        onPick={(station) => {
          goTo(station);
          if (decideSource(station).kind === 'play') void startStation(station);
        }}
        onSurprise={surprise}
      />

      <SearchOverlay
        open={favoritesOpen}
        showFavorites
        favorites={favorites.stations}
        onClose={() => setFavoritesOpen(false)}
        onPick={(station) => {
          goTo(station);
          setFavoritesOpen(false);
        }}
        onSurprise={surprise}
      />

      <StationInfoModal
        station={infoOpen ? selected : null}
        isFavorite={selected ? favorites.has(selected.id) : false}
        onClose={() => setInfoOpen(false)}
        onToggleFavorite={toggleFavorite}
        onShare={(station) => void share(station)}
        onOpenSource={openSource}
      />

      <Toast message={toast} />

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <div className="visually-hidden">
        Categories: {CATEGORIES.map((entry) => entry.label).join(', ')}
      </div>
    </div>
  );
}
