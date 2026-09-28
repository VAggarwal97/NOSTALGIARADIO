import type { Category, CategoryId } from '../types/station';

export const CATEGORIES: Category[] = [
  {
    id: 'mix',
    label: 'Mix',
    shortLabel: 'Mix',
    tagline: 'A broad nostalgia rotation from every corner of the archive.',
    icon: '✦',
  },
  {
    id: 'transit',
    label: 'Travel',
    shortLabel: 'Travel',
    tagline: 'Road, bus, highway, railway and journey radio.',
    icon: '🚌',
  },
  {
    id: 'beyond-india',
    label: 'Beyond',
    shortLabel: 'Beyond',
    tagline: 'International and cross-border nostalgia.',
    icon: '🌐',
  },
  {
    id: 'regional-folk',
    label: 'Folk',
    shortLabel: 'Folk',
    tagline: 'Regional folk, language and traditional sounds.',
    icon: '🪘',
  },
  {
    id: 'ambient',
    label: 'Ambient',
    shortLabel: 'Ambient',
    tagline: 'Rain, café, late night, study and atmospheric listening.',
    icon: '🎧',
  },
  {
    id: 'festival',
    label: 'Festivals',
    shortLabel: 'Festivals',
    tagline: 'Holi, Diwali, Chhath, Eid, weddings and seasonal occasions.',
    icon: '🪔',
  },
  {
    id: 'work',
    label: 'Work',
    shortLabel: 'Work',
    tagline: 'Workshops, builders, factories, drivers, offices and trades.',
    icon: '🧵',
  },
  {
    id: 'shops',
    label: 'Shop',
    shortLabel: 'Shop',
    tagline: 'Markets, bazaars, street shopping and commercial nostalgia.',
    icon: '🏪',
  },
];

export const CATEGORY_MAP: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export const isCategoryId = (value: string): value is CategoryId => value in CATEGORY_MAP;
