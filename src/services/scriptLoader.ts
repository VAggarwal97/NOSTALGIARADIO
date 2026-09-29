/**
 * One script tag per URL, ever. Provider APIs load lazily — only when a station
 * that needs one is actually selected, so the first paint never waits on them.
 */
const loaders = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
  const cached = loaders.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      loaders.delete(src); // a later retry may succeed (offline → online)
      reject(new Error(`Failed to load script: ${src}`));
    });
    document.head.appendChild(script);
  });

  loaders.set(src, promise);
  return promise;
}
