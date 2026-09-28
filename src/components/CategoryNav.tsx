import { CATEGORIES } from '../data/categories';
import type { CategoryId } from '../types/station';

interface CategoryNavProps {
  active: CategoryId;
  onSelect: (id: CategoryId) => void;
}

export function CategoryNav({ active, onSelect }: CategoryNavProps) {
  return (
    <nav className="category-nav" aria-label="Categories">
      {CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className="chip"
          aria-pressed={active === category.id}
          title={category.tagline}
          onClick={() => onSelect(category.id)}
        >
          {category.shortLabel}
        </button>
      ))}
    </nav>
  );
}
