import type { EditorialMoment } from '../types/station';

/**
 * Cinematic breaks between rails so the page reads as an editorial experience
 * rather than a directory. One sentence, one atmospheric scene, no controls.
 */
export const EDITORIAL_MOMENTS: Record<string, EditorialMoment> = {
  default: {
    id: 'tea-stall-to-highway',
    quote: 'From the tea stall to the highway.',
    caption: 'Everything here was recorded in somebody’s ordinary day.',
    artwork: '/art/tea-stall.svg',
  },
  transit: {
    id: 'long-way-home',
    quote: 'Songs that sound like the long way home.',
    caption: 'Window down, meter running, the last cassette still playing.',
    artwork: '/art/highway.svg',
  },
  'beyond-india': {
    id: 'postcards-elsewhere',
    quote: 'Postcards from elsewhere, set to music.',
    caption: 'Same nostalgia, different coastline.',
    artwork: '/art/cafe.svg',
  },
  'regional-folk': {
    id: 'village-fair',
    quote: 'The village fair never really closed.',
    caption: 'Strings, drums and voices carried across fields.',
    artwork: '/art/desert.svg',
  },
  ambient: {
    id: 'rainy-delhi-evening',
    quote: 'Songs that sound like a rainy Delhi evening.',
    caption: 'Kettle on, balcony door open, nothing urgent.',
    artwork: '/art/rainy-street.svg',
  },
  festival: {
    id: 'festival-radio',
    quote: 'Festival radio from across India.',
    caption: 'Lamps, drums and the same chorus every year.',
    artwork: '/art/festival.svg',
  },
  work: {
    id: 'ten-hour-shift',
    quote: 'A ten-hour shift goes easier with a good song.',
    caption: 'Workshop radios have better taste than most of us.',
    artwork: '/art/workshop.svg',
  },
  shops: {
    id: 'bazaar-hours',
    quote: 'The bazaar has its own playlist.',
    caption: 'Shopkeepers have been curating longer than any algorithm.',
    artwork: '/art/market.svg',
  },
  tonights: {
    id: 'tonights-rotation',
    quote: 'Tonight’s rotation — 100 songs, no repeat.',
    caption: 'Curated by memory, not by meter.',
    artwork: '/art/neighborhood.svg',
  },
};
