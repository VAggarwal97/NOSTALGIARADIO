/**
 * Support / donation settings.
 *
 * `SUPPORT_URL` is the single place to drop a real payment link (UPI deep link,
 * Razorpay/Stripe checkout, Buy-Me-a-Coffee, etc.). The validator flags the
 * placeholder so it never ships unnoticed.
 */
export const SUPPORT_URL = 'https://example.org/nostalgia-radio-support';

/** Preset amounts in rupees — shown as chips before the custom field. */
export const SUPPORT_TIERS = [100, 250, 500, 1000] as const;

/** What contributions keep alive. Only claims that are true for this project. */
export const SUPPORT_USES = [
  'Hosting and bandwidth for the stream',
  'Artwork, curation and new stations',
  'Archive maintenance and audio hosting',
  'Keeping the experience ad-light',
] as const;
