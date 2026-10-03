/**
 * The navbar DONATE slot.
 *
 * V1 ships the button only — no donation page, no payment flow, no form.
 * The href stays empty until a real destination exists, so the navbar never
 * ships a dead "#" link: paste the destination into `site_settings`
 * (`donation_url`, set publicly visible) from /admin → Settings and the
 * button enables itself live — or fill `href` here to hardcode it.
 */
export const DONATE_LINK = {
  label: 'Donate',
  /** Empty = not configured yet (renders as a disabled slot, never a dead link). */
  href: '',
  external: true,
} as const;
