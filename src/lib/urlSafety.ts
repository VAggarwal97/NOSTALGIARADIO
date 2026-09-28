const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'blob:', 'vbscript:', 'file:', 'about:']);

export type UrlVerdict = 'safe' | 'unsafe' | 'relative';

/**
 * Validate every URL before it is rendered or navigated to.
 * Relative app paths (`/audio/…`, `/icons/…`) are allowed; anything else must be
 * absolute http(s). Everything else is rejected rather than sanitised.
 */
export function classifyUrl(raw: string): UrlVerdict {
  const value = raw.trim();
  if (!value) return 'unsafe';

  if (value.startsWith('/') && !value.startsWith('//')) return 'relative';

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'unsafe';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol)) return 'unsafe';
  if (!ALLOWED_PROTOCOLS.has(protocol)) return 'unsafe';
  if (parsed.username || parsed.password) return 'unsafe';

  return 'safe';
}

export function isSafeUrl(raw: string): boolean {
  return classifyUrl(raw) !== 'unsafe';
}

export function safeExternalUrl(raw: string): string | null {
  return classifyUrl(raw) === 'safe' ? raw.trim() : null;
}

/** Shared tab opener: new tab, no opener, no noreferrer-leak of the app URL. */
export function openExternally(raw: string): boolean {
  const url = safeExternalUrl(raw);
  if (!url) return false;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win) win.opener = null;
  return true;
}

/** Metadata must never carry executable markup. */
export function containsExecutableMarkup(value: string): boolean {
  return /<\s*script|<\s*iframe|javascript:|on\w+\s*=|data:text\/html/i.test(value);
}
