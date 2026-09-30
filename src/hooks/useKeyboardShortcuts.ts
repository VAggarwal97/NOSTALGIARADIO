import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  togglePlay: () => void;
  /** Seeks when the loaded track has real duration, otherwise changes station. */
  previous: () => void;
  next: () => void;
  toggleMute: () => void;
  openSearch: () => void;
  toggleHelp: () => void;
  share: () => void;
  surprise: () => void;
  closeOverlays: () => void;
  volumeUp: () => void;
  volumeDown: () => void;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** App-wide keyboard controls. Every action also has a visible control. */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, disabled = false): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The admin panel owns its own keys: no radio shortcuts while typing or
      // operating the control room.
      if (disabledRef.current) return;
      const handlersNow = ref.current;

      if (event.key === 'Escape') {
        handlersNow.closeOverlays();
        return;
      }

      const typing = isTypingTarget(event.target);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlersNow.openSearch();
        return;
      }

      if (typing) return;

      // Let Space activate a focused button/link natively instead of double-firing.
      if (
        event.key === ' ' &&
        event.target instanceof HTMLElement &&
        ['BUTTON', 'A', 'SUMMARY'].includes(event.target.tagName)
      ) {
        return;
      }

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault();
          handlersNow.togglePlay();
          break;
        case '/':
          event.preventDefault();
          handlersNow.openSearch();
          break;
        case '?':
          event.preventDefault();
          handlersNow.toggleHelp();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          handlersNow.previous();
          break;
        case 'ArrowRight':
          event.preventDefault();
          handlersNow.next();
          break;
        case 'm':
          handlersNow.toggleMute();
          break;
        case 's':
          handlersNow.share();
          break;
        case 'r':
          handlersNow.surprise();
          break;
        case 'ArrowUp':
          event.preventDefault();
          handlersNow.volumeUp();
          break;
        case 'ArrowDown':
          event.preventDefault();
          handlersNow.volumeDown();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
