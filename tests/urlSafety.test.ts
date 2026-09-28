import { describe, expect, it } from 'vitest';
import { classifyUrl, containsExecutableMarkup, isSafeUrl, openExternally, safeExternalUrl } from '../src/lib/urlSafety';

describe('classifyUrl', () => {
  it('accepts http and https', () => {
    expect(classifyUrl('https://example.org/station')).toBe('safe');
    expect(classifyUrl('http://example.org/station')).toBe('safe');
  });

  it('accepts same-origin relative paths', () => {
    expect(classifyUrl('/audio/demo-a.wav')).toBe('relative');
    expect(classifyUrl('/icons/favicon.svg')).toBe('relative');
  });

  it('rejects dangerous protocols', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'blob:https://example.org/uuid',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'about:blank',
    ]) {
      expect(classifyUrl(url), url).toBe('unsafe');
    }
  });

  it('rejects protocol-relative and malformed values', () => {
    expect(classifyUrl('//evil.example/path')).toBe('unsafe');
    expect(classifyUrl('not a url')).toBe('unsafe');
    expect(classifyUrl('   ')).toBe('unsafe');
  });

  it('rejects embedded credentials', () => {
    expect(classifyUrl('https://user:pass@example.org/')).toBe('unsafe');
  });
});

describe('helpers', () => {
  it('isSafeUrl mirrors classifyUrl', () => {
    expect(isSafeUrl('https://example.org')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('safeExternalUrl only returns validated absolute URLs', () => {
    expect(safeExternalUrl('https://example.org')).toBe('https://example.org');
    expect(safeExternalUrl('/relative')).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('detects executable markup', () => {
    expect(containsExecutableMarkup('<script>alert(1)</script>')).toBe(true);
    expect(containsExecutableMarkup('<img src=x onerror=alert(1)>')).toBe(true);
    expect(containsExecutableMarkup('javascript:alert(1)')).toBe(true);
    expect(containsExecutableMarkup('90s Hindi songs from cassette inserts')).toBe(false);
  });

  it('openExternally refuses unsafe targets', () => {
    expect(openExternally('javascript:alert(1)')).toBe(false);
  });
});
