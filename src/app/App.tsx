import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CATEGORIES, CATEGORY_MAP, isCategoryId } from '../data/categories';
import type { CategoryId, Station } from '../types/station';

import { findStation, neighbours, randomStation, stationsForCategory } from '../lib/catalog';
import { audioUrlFor, decideSource, navigateSource } from '../lib/sourcePolicy';
import { shareStation } from '../lib/share';

import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useFavorites } from '../hooks/useFavorites';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTheme } from '../hooks/useTheme';

import { Header } from '../components/Header';
import { CategoryRail } from '../components/CategoryRail';
import { HeroStation } from '../components/HeroStation';
import { NowPlaying } from '../components/NowPlaying';
import { StationRail } from '../components/StationRail';
import { PlayerBar } from '../components/PlayerBar';
import { SearchDialog } from '../components/SearchDialog';
import { StationDrawer } from '../components/StationDrawer';
import { Toast } from '../components/Toast';

const queryParam = (name: string): string | null =>
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get(name);

export default function App() {
  const [theme, toggleTheme] = useTheme();

  const [category, setCategory] = useState<CategoryId>(() => {
    const fromUrl = queryParam('category');
    if (fromUrl && isCategoryId(fromUrl)) return fromUrl;
    const linked = findStation(queryParam('station'));
    return linked ? linked.category : 'mix';
  });

  const [selected, setSelected] = useState<Station | null>(
    () => findStation(queryParam('station')) ?? stationsForCategory('mix')[0] ?? null,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [drawerStation, setDrawerStation] = useState<Station | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const favorites = useFavorites();
  const toastTimer = useRef<number | null>(null);

  const pool = useMemo(() => stationsForCategory(category), [category]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // The player hook keeps `onEnded` in a ref, so a stable trampoline is enough to
  // reach the latest `advance` without re-creating the audio element.
  const advanceRef = useRef<(direction: 1 | -1) => void>(() => {});
  const player = useAudioPlayer({ onEnded: () => advanceRef.current(1) });
  const playerRef = useRef(player);
  playerRef.current = player;

  /** Select + persist deep link. Autoplay is opt-in and only from a user gesture. */
  const goTo = useCallback((station: Station, autoplay = false) => {
    setSelected(station);
    setAnnouncement(`${station.name}. ${station.description}`);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('station', station.id);
      url.searchParams.set('category', station.category);
      window.history.replaceState({}, '', url);
    } catch {
      /* file:// or sandboxed context — deep links are a convenience, not a requirement */
    }

    if (autoplay) {
      const audioUrl = audioUrlFor(station);
      if (audioUrl) {
        playerRef.current.load(station.id, audioUrl);
        void playerRef.current.play();
      }
    }
  }, []);

  /** Always begin playback of a playable station; otherwise hand off to the source. */
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

  /** Player-bar play button: start, resume, pause, or hand off to the source. */
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

  const advance = useCallback(
    (direction: 1 | -1) => {
      const list = pool.length > 0 ? pool : stationsForCategory('mix');
      const { next, previous } = neighbours(selected, list);
      const target = direction === 1 ? next : previous;
      if (!target) return;
      const shouldAutoplay = playerRef.current.status === 'playing';
      goTo(target, shouldAutoplay);
    },
    [pool, selected, goTo],
  );

  advanceRef.current = advance;

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

  const closeOverlays = useCallback(() => {
    setSearchOpen(false);
    setFavoritesOpen(false);
    setDrawerStation(null);
  }, []);

  const openSearch = useCallback(() => {
    setFavoritesOpen(false);
    setSearchOpen(true);
  }, []);

  const isCurrentTrack = Boolean(selected && player.stationId === selected.id);
  const canPlay = Boolean(selected && decideSource(selected).kind === 'play');
  const playingId = player.status === 'playing' ? player.stationId : null;

  useKeyboardShortcuts({
    togglePlay: () => void togglePlay(),
    previous: () => advance(-1),
    next: () => advance(1),
    toggleMute: player.toggleMute,
    openSearch,
    toggleFavorite: () => toggleFavorite(selected),
    share: () => void share(selected),
    surprise,
    closeOverlays,
    volumeUp: () => player.setVolume(player.volume + 0.1),
    volumeDown: () => player.setVolume(player.volume - 0.1),
  });

  const activeCategory = CATEGORY_MAP[category];
  const railTitle = category === 'mix' ? 'Featured picks' : (activeCategory?.label ?? 'Stations');
  const railHint =
    category === 'mix' ? 'One from every corner · press / to search' : (activeCategory?.tagline ?? '');

  return (
    <div className="app grain">
      <Header
        rail={<CategoryRail active={category} onSelect={setCategory} />}
        favoriteCount={favorites.count}
        theme={theme}
        onOpenSearch={openSearch}
        onOpenFavorites={() => {
          setSearchOpen(false);
          setFavoritesOpen(true);
        }}
        onSurprise={surprise}
        onToggleTheme={toggleTheme}
      />

      <main className="main">
        <HeroStation
          station={selected}
          isFavorite={selected ? favorites.has(selected.id) : false}
          status={player.status}
          isCurrentTrack={isCurrentTrack}
          analyser={player.analyser}
          onTogglePlay={() => void togglePlay()}
          onOpenSource={openSource}
          onToggleFavorite={toggleFavorite}
          onShare={(station) => void share(station)}
          onDetails={(station) => setDrawerStation(station)}
        />

        <NowPlaying
          station={selected}
          status={player.status}
          isCurrentTrack={isCurrentTrack}
          currentTime={player.currentTime}
          duration={player.duration}
          error={player.error}
          onSeek={player.seek}
          onOpenSource={openSource}
        />

        <StationRail
          stations={pool}
          selectedId={selected?.id ?? null}
          playingId={playingId}
          favoriteIds={favorites.ids}
          title={railTitle}
          hint={railHint}
          emptyMessage={
            category === 'mix'
              ? 'No featured stations yet — pick a category above.'
              : 'Nothing in this category yet. Try another one.'
          }
          onSelect={handleSelect}
          onPrimary={handlePrimary}
        />
      </main>

      <PlayerBar
        station={selected}
        status={player.status}
        isCurrentTrack={isCurrentTrack}
        volume={player.volume}
        muted={player.muted}
        canPlay={canPlay}
        onPrevious={() => advance(-1)}
        onNext={() => advance(1)}
        onTogglePlay={() => void togglePlay()}
        onVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onOpenSearch={openSearch}
      />

      <SearchDialog
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

      <SearchDialog
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

      <StationDrawer
        station={drawerStation}
        isFavorite={drawerStation ? favorites.has(drawerStation.id) : false}
        onClose={() => setDrawerStation(null)}
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
