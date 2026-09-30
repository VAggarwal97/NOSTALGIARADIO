import { useCallback, useEffect, useRef, useState } from 'react';

import { getRequestApi } from '../lib/request-api';
import type { SongRequest } from '../lib/request-api';
import { requestIdFromSearch, shareHref } from '../lib/routes';
import type { Station } from '../types/station';

import { RequestBoard } from './RequestBoard';
import { SuggestConsole } from './SuggestConsole';

interface SuggestPageProps {
  /** Same artwork the radio is hearing — the page keeps the station's soul. */
  station: Station | null;
  onNotify: (message: string) => void;
  /** The request currently on air — its card shows the live On air state. */
  activeRequestId: string | null;
  /** Plays a request on demand from its own card (explicit listener gesture). */
  onPlayRequest: (request: SongRequest) => void;
  /** After a submit or a confirmed vote: airs it only if the radio never started. */
  onMaybeAir: (request: SongRequest) => void;
}

const HOW_IT_WORKS = [
  {
    index: '01',
    title: 'Share a song',
    copy: 'Found something that belongs on Nostalgia Radio?\nDrop the link.',
  },
  {
    index: '02',
    title: 'Get the community behind it',
    copy: 'Share your request and\ncollect votes.',
  },
  {
    index: '03',
    title: 'Make it to the radio',
    copy: 'Popular requests move into\nthe upcoming radio queue.',
  },
] as const;

/**
 * Suggest Your Music — the participation half of the site. Same typography,
 * palette and player as the radio screen, but a vertical editorial
 * composition: hero → request console → how it works → the community wall.
 * The station keeps playing while you browse; nothing here restarts audio,
 * and every number on the page comes from the request API, never from copy.
 */
export function SuggestPage({
  station,
  onNotify,
  activeRequestId,
  onPlayRequest,
  onMaybeAir,
}: SuggestPageProps) {
  const [focusToken, setFocusToken] = useState(0);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [requestedMissing, setRequestedMissing] = useState(false);
  const deepLinkChecked = useRef(false);

  /** Share: native sheet where available, clipboard otherwise. */
  const shareRequest = useCallback(
    async (request: SongRequest) => {
      const url = `${window.location.origin}${shareHref(request.id)}`;
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: `${request.title} — Nostalgia Radio`, url });
          return;
        } catch (error) {
          // A cancelled sheet is not a failure worth nagging about.
          if ((error as { name?: string })?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        onNotify('Link copied.');
      } catch {
        onNotify('Sharing is unavailable in this browser.');
      }
    },
    [onNotify],
  );

  // Shared link: /suggest-music?request=<id> → find it, take its tab, flash it.
  useEffect(() => {
    if (deepLinkChecked.current) return;
    deepLinkChecked.current = true;
    const id = typeof window === 'undefined' ? null : requestIdFromSearch(window.location.search);
    if (!id) return;
    void getRequestApi()
      .get(id)
      .then((found) => {
        if (!found) {
          setRequestedMissing(true);
          return;
        }
        setSpotlightId(found.id);
      })
      .catch(() => {
        // Outage while checking a shared link: the board still loads on its
        // own; don't tell the visitor their request is gone.
      });
  }, []);

  const jumpTo = useCallback((request: SongRequest) => {
    setRequestedMissing(false);
    // The board finds the request (switching tabs if needed), scrolls and flashes.
    setSpotlightId(request.id);
  }, []);

  const focusConsole = useCallback(() => setFocusToken((token) => token + 1), []);

  return (
    <div className="suggest-page">
      {/* The station's artwork, quiet and fixed — same world, new composition. */}
      <div className="suggest-bg" aria-hidden="true">
        {station ? <img src={station.artwork} alt="" decoding="async" /> : null}
      </div>

      <main className="suggest-main">
        <header className="suggest-hero">
          <p className="suggest-eyebrow">Community radio</p>
          <h1 className="suggest-title">
            <span>Suggest</span>
            <span>Your music</span>
          </h1>
          <p className="suggest-lede">Get the songs you want to hear onto Nostalgia Radio.</p>
          <p className="suggest-sub">
            Paste a Spotify or YouTube track, share it with the community, and let the votes
            decide what should play next.
          </p>

          <SuggestConsole
            stationId={station?.id ?? null}
            focusToken={focusToken}
            onSubmitted={(request) => {
              setRequestedMissing(false);
              setSpotlightId(request.id);
              // A brand-new request goes straight to a silent radio — nothing to
              // interrupt, and the submit click is the gesture that allows it.
              onMaybeAir(request);
            }}
            onJumpTo={jumpTo}
          />
        </header>

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title" className="how-title">
            How it works
          </h2>
          <div className="how-grid">
            {HOW_IT_WORKS.map((step) => (
              <article key={step.index} className="how-step">
                <p className="how-index" aria-hidden="true">
                  {step.index}
                </p>
                <h3 className="how-step-title">{step.title}</h3>
                <p className="how-step-copy">
                  {step.copy.split('\n').map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </p>
              </article>
            ))}
          </div>
        </section>

        <RequestBoard
          spotlightId={spotlightId}
          requestedMissing={requestedMissing}
          onRequestFirst={focusConsole}
          onShare={(request) => void shareRequest(request)}
          activeRequestId={activeRequestId}
          onPlayRequest={onPlayRequest}
          onMaybeAir={onMaybeAir}
        />

        <p className="suggest-keep">
          <span>Keep listening</span>
          The player below stays with you while you browse.
        </p>
      </main>
    </div>
  );
}
