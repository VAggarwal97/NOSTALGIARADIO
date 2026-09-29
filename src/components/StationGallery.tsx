import { useEffect, useRef } from 'react';
import { CATEGORIES } from '../data/categories';
import { STATIONS } from '../data/stations';
import { findStation, stationsForCategory } from '../lib/catalog';
import { heroMeta } from '../lib/hero';
import type { CategoryId } from '../types/station';

interface StationGalleryProps {
  /** The category the hero currently speaks for. */
  activeCategory: CategoryId;
  /** True while the hero station is actually audible. */
  live: boolean;
  onSelect: (id: CategoryId) => void;
  /** Opens the full station list — the gallery never grows into a sidebar. */
  onExploreAll: () => void;
}

/* The archive drifts at a walking pace — alive, never busy. */
const DRIFT_SPEED = 22; // px per second
const RESUME_AFTER = 4000; // manual interaction → wait, then resume
const HOVER_RESUME_AFTER = 3000; // pointer leaves → breathe, then resume
const START_DELAY = 1400; // let the first paint settle before moving

/**
 * The right side of the hero: eight miniature posters, one per listening
 * world, inside a bounded viewport that drifts slowly like an archive
 * conveyor. Any wheel, touch, key, click or hover pauses it; a few idle
 * seconds later it resumes. Pressing a card re-tunes the same screen —
 * it never navigates, and it never turns into a dashboard.
 */
export function StationGallery({
  activeCategory,
  live,
  onSelect,
  onExploreAll,
}: StationGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof window === 'undefined') return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const railMode = window.matchMedia('(max-width: 860px)'); // mobile keeps its snap rail

    let frame = 0;
    let last = performance.now();
    let expected = el.scrollTop;
    let cycle = 0;
    let hovering = false;
    let pausedUntil = performance.now() + START_DELAY;

    // Loop distance: the first cloned card sits exactly one copy down, so
    // wrapping the scroll position there is pixel-identical and seamless.
    const measure = () => {
      const track = el.firstElementChild;
      const first = track?.children[0] as HTMLElement | undefined;
      const clone = track?.children[CATEGORIES.length] as HTMLElement | undefined;
      cycle = first && clone ? clone.offsetTop - first.offsetTop : 0;
      expected = el.scrollTop;
    };
    measure();

    const track = el.firstElementChild;
    const observer =
      typeof ResizeObserver !== 'undefined' && track ? new ResizeObserver(measure) : null;
    observer?.observe(track as Element);

    const nudge = () => {
      pausedUntil = performance.now() + RESUME_AFTER;
    };
    const onEnter = () => {
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
      pausedUntil = performance.now() + HOVER_RESUME_AFTER;
    };
    const onScroll = () => {
      // A scroll we didn't write is the user's (scrollbar drag, keyboard,
      // programmatic) — pause instead of fighting them over position.
      if (Math.abs(el.scrollTop - expected) > 1.5) {
        nudge();
        expected = el.scrollTop;
      }
    };

    el.addEventListener('wheel', nudge, { passive: true });
    el.addEventListener('touchstart', nudge, { passive: true });
    el.addEventListener('pointerdown', nudge);
    el.addEventListener('keydown', nudge);
    el.addEventListener('focusin', nudge);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('scroll', onScroll, { passive: true });

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const dt = Math.min(now - last, 90); // tab wakes up → don't jump
      last = now;
      if (
        reduceMotion.matches ||
        railMode.matches ||
        hovering ||
        now < pausedUntil ||
        cycle <= 0
      ) {
        return;
      }
      let next = el.scrollTop + (DRIFT_SPEED * dt) / 1000;
      if (next >= cycle) next -= cycle;
      expected = next;
      el.scrollTop = next;
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      el.removeEventListener('wheel', nudge);
      el.removeEventListener('touchstart', nudge);
      el.removeEventListener('pointerdown', nudge);
      el.removeEventListener('keydown', nudge);
      el.removeEventListener('focusin', nudge);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  const card = (category: (typeof CATEGORIES)[number], clone: boolean) => {
    const flagship = findStation(category.flagship);
    const isActive = category.id === activeCategory;
    const count = stationsForCategory(category.id).length;
    const status = isActive ? (live ? 'On air' : 'Ready') : `${count} stations`;

    return (
      <button
        key={clone ? `clone-${category.id}` : category.id}
        type="button"
        className="station-card"
        data-active={isActive ? 'true' : undefined}
        data-live={isActive && live ? 'true' : undefined}
        aria-pressed={isActive}
        // The second copy exists only for the seamless loop: invisible to
        // assistive tech and out of the tab order.
        aria-hidden={clone || undefined}
        tabIndex={clone ? -1 : undefined}
        onClick={() => onSelect(category.id)}
        title={
          flagship
            ? `${category.label} — tunes into ${flagship.name}`
            : `${category.label} category`
        }
      >
        {flagship ? (
          <img
            className="station-card-art"
            src={flagship.artwork}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        ) : null}
        <span className="station-card-scrim" aria-hidden="true" />

        <span className="station-card-status">
          <span className="dot" aria-hidden="true" />
          {status}
        </span>

        <span className="station-card-body">
          <span className="station-card-name">{category.label}</span>
          <span className="station-card-tag">{category.tagline}</span>
          <span className="station-card-meta">
            {flagship ? heroMeta(flagship).join(' · ') : category.shortLabel}
          </span>
        </span>

        <span className="station-card-arrow" aria-hidden="true">
          →
        </span>
      </button>
    );
  };

  return (
    <div className="gallery" role="group" aria-label="Radio categories">
      <div className="gallery-head">
        <p className="gallery-eyebrow">Explore the radio</p>
        <p className="gallery-count">{STATIONS.length} stations</p>
      </div>

      <div className="station-grid" ref={viewportRef} tabIndex={-1}>
        <div className="station-track">
          {CATEGORIES.map((category) => card(category, false))}
          {CATEGORIES.map((category) => card(category, true))}
        </div>
      </div>

      <button type="button" className="gallery-more" onClick={onExploreAll}>
        Explore all stations <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
