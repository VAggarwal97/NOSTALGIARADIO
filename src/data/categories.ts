import type { Category, CategoryId } from '../types/station';

/**
 * Categories are **station selectors**, not pages. `flagship` is the station the
 * hero switches to when the chip is pressed; `accent` tints that experience.
 */
export const CATEGORIES: Category[] = [
  {
    id: 'mix',
    label: 'Mix',
    shortLabel: 'Mix',
    tagline: 'A broad nostalgia rotation from every corner of the archive.',
    icon: '✦',
    flagship: 'nostalgia-radio',
    accent: '#f05a45',
  },
  {
    id: 'transit',
    label: 'Travel',
    shortLabel: 'Travel',
    tagline: 'Road, bus, highway, railway and journey radio.',
    icon: '🚌',
    flagship: 'truck-wala-radio',
    accent: '#e2543a',
  },
  {
    id: 'beyond-india',
    label: 'Beyond',
    shortLabel: 'Beyond',
    tagline: 'International and cross-border nostalgia.',
    icon: '🌐',
    flagship: 'desi-world-radio',
    accent: '#d89a54',
  },
  {
    id: 'regional-folk',
    label: 'Folk',
    shortLabel: 'Folk',
    tagline: 'Regional folk, language and traditional sounds.',
    icon: '🪘',
    flagship: 'rajasthani-folk',
    accent: '#c4633f',
  },
  {
    id: 'ambient',
    label: 'Ambient',
    shortLabel: 'Ambient',
    tagline: 'Rain, café, late night, study and atmospheric listening.',
    icon: '🎧',
    flagship: 'rain-window-radio',
    accent: '#e7c88b',
  },
  {
    id: 'festival',
    label: 'Festivals',
    shortLabel: 'Festivals',
    tagline: 'Holi, Diwali, Chhath, Eid, weddings and seasonal occasions.',
    icon: '🪔',
    flagship: 'holi-gulal-fm',
    accent: '#e8663a',
  },
  {
    id: 'work',
    label: 'Work',
    shortLabel: 'Work',
    tagline: 'Workshops, builders, factories, drivers, offices and trades.',
    icon: '🧵',
    flagship: 'kaam-wala-radio',
    accent: '#d89a54',
  },
  {
    id: 'shops',
    label: 'Shop',
    shortLabel: 'Shop',
    tagline: 'Markets, bazaars, street shopping and commercial nostalgia.',
    icon: '🏪',
    flagship: 'bazaar-radio',
    accent: '#f05a45',
  },
];

export const CATEGORY_MAP: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export const isCategoryId = (value: string): value is CategoryId => value in CATEGORY_MAP;
