import { CATEGORIES } from '../data/categories';
import type { CategoryId } from '../types/station';

interface CategoryRailProps {
  active: CategoryId;
  onSelect: (id: CategoryId) => void;
  id?: string;
}

export function CategoryRail({ active, onSelect, id = 'category-rail' }: CategoryRailProps) {
  return (
    <div className="categories" role="tablist" aria-label="Station categories" id={id}>
      {CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          className="chip"
          aria-selected={active === category.id}
          aria-controls="station-rail"
          title={category.tagline}
          onClick={() => onSelect(category.id)}
        >
          <span className="chip-icon" aria-hidden="true">
            {category.icon}
          </span>
          {category.shortLabel}
        </button>
      ))}
    </div>
  );
}
