/**
 * Anonymous, per-session identifiers — no storage, no accounts, no cookies.
 * These identify "this tab right now", never a person.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
