import { useEffect, useRef, useState } from 'react';
import type { Station } from '../types/station';
import { useStationRating } from '../hooks/useStationRating';

interface CommunityControlsProps {
  /** Ratings belong to the station, never to the category. */
  station: Station | null;
  /** Opens the suggestion modal — same overlay the navbar triggers. */
  onSuggest: () => void;
}

const pluralRatings = (count: number) => `${count} rating${count === 1 ? '' : 's'}`;

/**
 * "Participate in the radio" — two quiet controls sitting beside the player
 * (above it on narrow screens). The player itself stays playback-only.
 * Aggregates come from the rating API: real numbers or an honest empty state.
 */
export function CommunityControls({ station, onSuggest }: CommunityControlsProps) {
  const { summary, pending, rate } = useStationRating(station?.id ?? null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const [thanks, setThanks] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const thanksTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (thanksTimer.current) window.clearTimeout(thanksTimer.current);
    },
    [],
  );

  if (!station) return null;

  const count = summary?.count ?? 0;
  const average = summary?.average;
  const mine = summary?.mine;
  const preview = hover || mine || 0;

  const submit = (value: number) => {
    void rate(value).then((next) => {
      if (!next) return;
      setThanks(true);
      if (thanksTimer.current) window.clearTimeout(thanksTimer.current);
      // A beat of gratitude, then the popover folds itself away.
      thanksTimer.current = window.setTimeout(() => {
        setThanks(false);
        setOpen(false);
      }, 1800);
    });
  };

  return (
    <div className="community-controls" ref={rootRef}>
      <div className="rate-slot">
        <button
          type="button"
          className="rate-trigger"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setThanks(false);
            setHover(0);
          }}
        >
          <span className="rate-score">
            {count > 0 && average != null ? `★ ${average.toFixed(1)}` : '★ Rate'}
          </span>
          <span className="rate-sub">{count > 0 ? pluralRatings(count) : 'Be the first'}</span>
        </button>

        {open ? (
          <div className="rate-popover" role="dialog" aria-label={`Rate ${station.name}`}>
            <p className="rate-pop-title">Rate this station</p>
            <div className="rate-stars" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rate-star"
                  data-on={preview >= value}
                  aria-pressed={mine === value}
                  aria-label={`Rate ${value} of 5`}
                  disabled={pending}
                  onMouseEnter={() => setHover(value)}
                  onFocus={() => setHover(value)}
                  onClick={() => submit(value)}
                >
                  {preview >= value ? '★' : '☆'}
                </button>
              ))}
            </div>
            <p className="rate-pop-note" aria-live="polite">
              {thanks
                ? 'Thanks for rating'
                : count > 0
                  ? `${count} ${count === 1 ? 'person has' : 'people have'} rated`
                  : 'No ratings yet'}
            </p>
          </div>
        ) : null}
      </div>

      <button type="button" className="suggest-btn" onClick={onSuggest}>
        + Suggest music
      </button>
    </div>
  );
}
