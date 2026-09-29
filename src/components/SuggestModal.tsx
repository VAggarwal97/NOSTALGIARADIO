import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Station } from '../types/station';
import { getRequestApi, type SuggestFailure } from '../lib/request-api';
import { CloseIcon } from './Icons';

interface SuggestModalProps {
  /** Suggestions keep their context: they belong to what you are hearing. */
  station: Station | null;
  onClose: () => void;
}

const errorCopy: Record<SuggestFailure, string> = {
  'invalid-url': "That doesn't look like a YouTube video or Spotify track link.",
  duplicate: 'This song is already in the community queue.',
  'rate-limited': 'You have sent a few suggestions already — try again in a minute.',
};

/**
 * The suggestion overlay — same dark/glass language as the other dialogs.
 * Validation, duplicate detection and rate limiting live behind the request
 * API, so the modal only ever renders honest outcomes. Mounted lazily: this
 * chunk is not downloaded until somebody asks for it.
 */
export function SuggestModal({ station, onClose }: SuggestModalProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<SuggestFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const raw = url.trim();
    if (!raw) return;
    setPending(true);
    setError(null);
    void getRequestApi()
      .submit({ url: raw, stationId: station?.id ?? null })
      .then((result) => {
        setPending(false);
        if (result.ok) {
          setDone(true);
          closeTimer.current = window.setTimeout(onClose, 3200);
        } else {
          setError(result.reason);
        }
      });
  };

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog dialog--suggest" role="dialog" aria-modal="true" aria-labelledby="suggest-title">
        <div className="modal-body">
          <div className="modal-head">
            <p className="eyebrow">Suggest music</p>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close suggestions">
              <CloseIcon size={16} />
            </button>
          </div>

          {done ? (
            <div className="suggest-done" aria-live="polite">
              <p className="suggest-done-title">✓ Song suggested</p>
              <p className="suggest-done-copy">
                Thanks — your suggestion has been added to the community queue.
              </p>
              <button type="button" className="suggest-submit" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <form className="suggest-form" onSubmit={submit}>
              <p className="suggest-context">
                <span>Suggest for</span>
                <strong>{station ? station.name : 'Nostalgia Radio'}</strong>
              </p>
              <p className="suggest-lede">Help choose what plays next.</p>

              <input
                ref={inputRef}
                className="suggest-input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste a Spotify or YouTube link…"
                aria-label="Song link"
                aria-invalid={error ? true : undefined}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
              />

              {error ? (
                <p className="suggest-error" role="alert">
                  {errorCopy[error]}
                </p>
              ) : null}

              <button type="submit" className="suggest-submit" disabled={pending || !url.trim()}>
                {pending ? 'Sending…' : '+ Submit song'}
              </button>

              <p className="suggest-note">YouTube and Spotify links supported.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default SuggestModal;
