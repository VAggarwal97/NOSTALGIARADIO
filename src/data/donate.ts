/**
 * The navbar DONATE slot.
 *
 * V1 ships the button only — no donation page, no payment flow, no form.
 * Point `href` at a real destination (UPI, GitHub Sponsors, Open Collective…)
 * whenever you have one; the validator flags the placeholder so it is never
 * forgotten before launch. `external: true` opens it in a new tab.
 */
export const DONATE_LINK = {
  label: 'Donate',
  href: '#',
  external: true,
} as const;
