import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { getRequestApi } from '../lib/request-api';
import type { SongProvider, SongRequest, TrackMeta } from '../lib/request-api';
import { parseSongUrl } from '../lib/request-api';
import { resolveTrackMeta } from '../lib/track-meta';

interface SuggestConsoleProps {
  /** Suggestions keep their context: they belong to what you are hearing. */
  stationId: string | null;
  /** Bumped by the empty state's "+ suggest the first song". */
  focusToken: number;
  onSubmitted: (request: SongRequest) => void;
  onJumpTo: (request: SongRequest) => void;
}

type Phase =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'network'
  | 'limited'
  | 'duplicate'
  | 'taken'
  | 'failed'
  | 'added';

const providerName = (provider: SongProvider) => (provider === 'spotify' ? 'Spotify' : 'YouTube');

/** Only complain once what was typed at least resembles a link. */
const looksLikeLink = (raw: string) => /^https?:\/\/\S+$/i.test(raw.trim());

const CHECK_DEBOUNCE = 350;

/**
 * The radio request console: paste a track link, see what the provider says
 * it is, then put it in front of the community. The URL provides all the
 * metadata — there is no form to fill in, and nothing on the preview is ever
 * invented. Duplicate, unavailable and rate-limited outcomes are honest
 * answers from the request API, not client-side guesses.
 */
export function SuggestConsole({
  stationId,
  focusToken,
  onSubmitted,
  onJumpTo,
}: SuggestConsoleProps) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [meta, setMeta] = useState<TrackMeta | null>(null);
  const [duplicate, setDuplicate] = useState<SongRequest | null>(null);
  const [added, setAdded] = useState<SongRequest | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkTimer = useRef<number | null>(null);
  /** Identity of the check in flight — a stale reply must not win. */
  const checkSeq = useRef(0);

  useEffect(
    () => () => {
      if (checkTimer.current !== null) window.clearTimeout(checkTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (focusToken > 0) {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [focusToken]);

  const runCheck = (raw: string) => {
    const song = parseSongUrl(raw);
    if (!song) {
      setPhase(looksLikeLink(raw) ? 'invalid' : 'idle');
      setMeta(null);
      setDuplicate(null);
      return;
    }
    const seq = (checkSeq.current += 1);
    setPhase('checking');
    setMeta(null);
    setDuplicate(null);

    void getRequestApi()
      .find(song.url)
      .then((existing) => {
        if (seq !== checkSeq.current) return;
        if (existing) {
          setDuplicate(existing);
          setPhase('duplicate');
          return;
        }
        return resolveTrackMeta(song).then((result) => {
          if (seq !== checkSeq.current) return;
          if (result.ok) {
            setMeta(result.meta);
            setPhase('ready');
          } else {
            setPhase(result.reason);
          }
        });
      })
      .catch(() => {
        if (seq !== checkSeq.current) return;
        setPhase('network');
      });
  };

  const onChange = (value: string) => {
    setUrl(value);
    setAdded(null);
    if (checkTimer.current !== null) window.clearTimeout(checkTimer.current);
    const trimmed = value.trim();
    if (!trimmed) {
      checkSeq.current += 1; // invalidate anything in flight
      setPhase('idle');
      setMeta(null);
      setDuplicate(null);
      return;
    }
    // Resolve quietly after a short pause — a paste checks immediately.
    checkTimer.current = window.setTimeout(
      () => runCheck(trimmed),
      value.length > 40 ? 60 : CHECK_DEBOUNCE,
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || phase !== 'ready' || !meta) return;
    const song = parseSongUrl(url);
    if (!song) return;
    setPending(true);
    void getRequestApi()
      .submit({ url: song.url, meta, stationId })
      .then((result) => {
        setPending(false);
        if (result.ok) {
          setAdded(result.request);
          setPhase('added');
          setUrl('');
          setMeta(null);
          onSubmitted(result.request);
        } else if (result.reason === 'duplicate') {
          // Somebody beat us to it — show their row instead of a second one.
          void getRequestApi()
            .find(song.url)
            .then((existing) => {
              if (existing) {
                setDuplicate(existing);
                setPhase('duplicate');
              } else {
                // The song exists (the database said so) but is not publicly
                // visible — say exactly that instead of a fake success.
                setPhase('taken');
                setMeta(null);
              }
            })
            .catch(() => {
              setPhase('failed');
              setMeta(null);
            });
        } else if (result.reason === 'rate-limited') {
          setPhase('limited');
          setMeta(null);
        } else {
          setPhase('invalid');
          setMeta(null);
        }
      })
      .catch(() => {
        // Outage or refusal: the request was NOT added — never imply it was.
        setPending(false);
        setPhase('failed');
      });
  };

  const reset = () => {
    setUrl('');
    setPhase('idle');
    setMeta(null);
    setDuplicate(null);
    setAdded(null);
    inputRef.current?.focus();
  };

  return (
    <form className="console" onSubmit={submit} aria-label="Suggest a song">
      <div className="console-field">
        <span className="console-glyph" aria-hidden="true">
          🔗
        </span>
        <input
          ref={inputRef}
          className="console-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a Spotify or YouTube song link…"
          aria-label="Song link"
          aria-invalid={phase === 'invalid' || phase === 'unavailable' ? true : undefined}
          value={url}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            const trimmed = url.trim();
            if (trimmed && phase === 'idle') runCheck(trimmed);
          }}
        />
        <button type="submit" className="console-submit" disabled={pending || phase !== 'ready'}>
          {pending ? 'Adding…' : '+ Suggest music'}
        </button>
      </div>

      <p className="console-hint">Spotify · YouTube · One song per request</p>

      {/* ── Resolved preview: what the provider says this link is ─────────── */}
      {phase === 'checking' ? (
        <p className="console-status" role="status">
          Reading that song…
        </p>
      ) : null}

      {phase === 'ready' && meta ? (
        <div className="preview" aria-live="polite">
          <PreviewArt artwork={meta.artwork} provider={parseSongUrl(url)?.provider ?? 'youtube'} />
          <div className="preview-body">
            <p className="preview-title">{meta.title}</p>
            <p className="preview-artist">{meta.artist}</p>
            <p className="preview-provider">{providerName(parseSongUrl(url)?.provider ?? 'youtube')}</p>
          </div>
          <button type="submit" className="preview-go" disabled={pending}>
            {pending ? 'Adding…' : 'Suggest this song →'}
          </button>
        </div>
      ) : null}

      {/* ── Honest failure states ─────────────────────────────────────────── */}
      {phase === 'invalid' ? (
        <div className="console-note console-note--bad" role="alert">
          <p className="console-note-title">That doesn't look like a supported song link.</p>
          <p className="console-note-copy">Try a Spotify track or YouTube video.</p>
        </div>
      ) : null}

      {phase === 'unavailable' ? (
        <div className="console-note console-note--bad" role="alert">
          <p className="console-note-title">This song isn't available</p>
          <p className="console-note-copy">
            The original source can't currently be played or accessed.
          </p>
          <p className="console-note-copy">Please try another song.</p>
        </div>
      ) : null}

      {phase === 'network' ? (
        <div className="console-note console-note--bad" role="alert">
          <p className="console-note-title">We couldn't read that song</p>
          <p className="console-note-copy">Please try again in a moment.</p>
          <button type="button" className="console-retry" onClick={() => runCheck(url.trim())}>
            Try again
          </button>
        </div>
      ) : null}

      {phase === 'limited' ? (
        <div className="console-note console-note--bad" role="alert">
          <p className="console-note-title">Too many requests</p>
          <p className="console-note-copy">
            You've submitted several songs recently — please wait a moment before trying again.
          </p>
        </div>
      ) : null}

      {phase === 'duplicate' && duplicate ? (
        <div className="console-note" role="status">
          <p className="console-note-title">
            {duplicate.status === 'played'
              ? 'This song was recently played'
              : 'This song is already in the community queue'}
          </p>
          <p className="console-note-song">{duplicate.title}</p>
          <p className="console-note-copy">{duplicate.artist}</p>
          <p className="console-note-votes">
            <span aria-hidden="true">▲</span> {duplicate.votes} vote{duplicate.votes === 1 ? '' : 's'}
          </p>
          <button type="button" className="console-retry" onClick={() => onJumpTo(duplicate)}>
            View request
          </button>
        </div>
      ) : null}

      {phase === 'taken' ? (
        <div className="console-note" role="status">
          <p className="console-note-title">This song has already been suggested</p>
          <p className="console-note-copy">It isn&apos;t open for new requests right now.</p>
          <button type="button" className="console-retry" onClick={reset}>
            Suggest another song
          </button>
        </div>
      ) : null}

      {phase === 'failed' ? (
        <div className="console-note console-note--bad" role="alert">
          <p className="console-note-title">We couldn&apos;t add your request</p>
          <p className="console-note-copy">
            The community wall didn&apos;t confirm it, so nothing was submitted.
          </p>
          <button
            type="button"
            className="console-retry"
            onClick={() => {
              if (meta) {
                setPhase('ready');
              } else {
                runCheck(url.trim());
              }
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {/* ── Success: the loop closes with a shareable request ─────────────── */}
      {phase === 'added' && added ? (
        <div className="console-note console-note--good" role="status">
          <p className="console-note-title">
            <span aria-hidden="true">✓</span> Song added to the community
          </p>
          <p className="console-note-song">{added.title}</p>
          <p className="console-note-copy">{added.artist}</p>
          <p className="console-note-copy">Your request is now open for votes.</p>
          <div className="console-note-actions">
            <button type="button" className="console-retry" onClick={() => onJumpTo(added)}>
              See your request
            </button>
            <button type="button" className="console-retry console-retry--ghost" onClick={reset}>
              Suggest another
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/** Provider artwork when we have it, a quiet monogram when we don't. */
function PreviewArt({ artwork, provider }: { artwork: string | null; provider: SongProvider }) {
  const [broken, setBroken] = useState(false);
  if (artwork && !broken) {
    return (
      <img
        className="preview-art"
        src={artwork}
        alt=""
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="preview-art preview-art--fallback" aria-hidden="true">
      {provider === 'spotify' ? '♪' : '▶'}
    </span>
  );
}
