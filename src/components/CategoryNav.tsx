import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_MAP } from '../data/categories';
import { findStation } from '../lib/catalog';
import type { CategoryId } from '../types/station';

interface CategoryNavProps {
  active: CategoryId;
  onSelect: (id: CategoryId) => void;
}

/**
 * Station selectors, not page links. The accent indicator slides between chips
 * so the header never changes shape — only the hero experience does.
 */
export function CategoryNav({ active, onSelect }: CategoryNavProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Partial<Record<CategoryId, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState({ x: 0, w: 0 });

  const measure = useCallback(() => {
    const chip = chipRefs.current[active];
    const nav = navRef.current;
    if (!chip || !nav) return;
    setIndicator({ x: chip.offsetLeft, w: chip.offsetWidth });

    // Keep the active chip visible inside the scrolling selector row.
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left - 16 < nav.scrollLeft) {
      nav.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
    } else if (right + 16 > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: right - nav.clientWidth + 16, behavior: 'smooth' });
    }
  }, [active]);

  // Measured after paint: the indicator slides from the left edge into place.
  useEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <div className="category-nav" ref={navRef} role="group" aria-label="Station selectors">
      <span
        className="chip-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator.x}px)`,
          width: `${indicator.w}px`,
          background: CATEGORY_MAP[active]?.accent,
        }}
      />

      {CATEGORIES.map((category) => {
        const flagship = findStation(category.flagship);
        return (
          <button
            key={category.id}
            type="button"
            className="chip"
            ref={(element) => {
              chipRefs.current[category.id] = element;
            }}
            aria-pressed={active === category.id}
            title={flagship ? `${flagship.name} — ${category.tagline}` : category.tagline}
            onClick={() => onSelect(category.id)}
          >
            {category.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
