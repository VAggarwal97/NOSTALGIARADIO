const PREFIX = 'nostalgia-radio:';

/** Non-sensitive preferences only. Never tokens, never identity data. */
export function readJson<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage disabled or full — preferences are optional, never blocking */
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

export const readStringArray = (key: string): string[] => readJson<string[]>(key, [], isStringArray);
export const readNumber = (key: string, fallback: number): number =>
  readJson<number>(key, fallback, (v): v is number => typeof v === 'number' && Number.isFinite(v));
export const readBoolean = (key: string, fallback: boolean): boolean =>
  readJson<boolean>(key, fallback, (v): v is boolean => typeof v === 'boolean');
export const readString = (key: string, fallback: string): string =>
  readJson<string>(key, fallback, (v): v is string => typeof v === 'string');
