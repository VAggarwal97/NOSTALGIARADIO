import type { Category, CategoryId } from '../types/station';

export const CATEGORIES: Category[] = [
  {
    id: 'mix',
    label: 'Mix',
    shortLabel: 'Mix',
    tagline: 'One selection from every corner of the archive.',
    icon: '✦',
  },
  {
    id: 'transit',
    label: 'Transit & Travel',
    shortLabel: 'Travel',
    tagline: 'Roads, buses, trucks, autos and long journeys.',
    icon: '🚌',
  },
  {
    id: 'beyond-india',
    label: 'Beyond India',
    shortLabel: 'Beyond',
    tagline: 'International nostalgia and cross-border memories.',
    icon: '🌐',
  },
  {
    id: 'regional-folk',
    label: 'Regional & Folk',
    shortLabel: 'Folk',
    tagline: 'Regional languages, folk traditions and local music.',
    icon: '🪘',
  },
  {
    id: 'ambient',
    label: 'Ambient Radio',
    shortLabel: 'Ambient',
    tagline: 'Mood, room, occupation and memory-based listening.',
    icon: '🎧',
  },
  {
    id: 'festival',
    label: 'Festival & Occasions',
    shortLabel: 'Festivals',
    tagline: 'Devotional, patriotic and celebration stations.',
    icon: '🪔',
  },
  {
    id: 'work',
    label: 'Work & Trade',
    shortLabel: 'Work',
    tagline: 'Workplaces, craft, labour and everyday soundtracks.',
    icon: '🧵',
  },
  {
    id: 'shops',
    label: 'Shops & Street Corners',
    shortLabel: 'Shops',
    tagline: 'Tapri, salon, paan shop, cyber café and neighbourhoods.',
    icon: '🏪',
  },
];

export const CATEGORY_MAP: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export const isCategoryId = (value: string): value is CategoryId => value in CATEGORY_MAP;
