import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import {
  isValidEmail,
  mapDbError,
  mapSendError,
  mapVerifyError,
  maskEmail,
} from './gateUtils';
import { AdminShell } from './AdminShell';
import type { AdminIdentity } from './adminTypes';

import '../styles/admin.css';

/**
 * /admin — the Admin Access Gate.
 *
 * There is no login page and no signup: the admin types an authorized email,
 * receives a one-time code (Supabase Auth passwordless), and the *database*
 * decides whether that identity may enter (`is_admin()` over admin_users —
 * RLS, server-side; a bypassed front end would still read/write nothing).
 *
 * Frontend checks here are UX only. The security lives in migration 4.
 */

type Phase =
  | 'unconfigured'
  | 'boot'
  | 'gate'
  | 'otp'
  | 'checking'
  | 'denied'
  | 'expired'
  | 'db-error'
  | 'ready';

/* ------------------------------------------------------------------ */
/* Presentational screens (exported so smoke render can assert them)   */
/* ------------------------------------------------------------------ */

export function Unconfigured(): JSX.Element {
  return (
    <div className="gate-card" role="alert">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <h1 className="gate-title">Private access</h1>
      <p className="gate-copy">
        Supabase is not configured. Add VITE_SUPABASE_URL and
        VITE_SUPABASE_PUBLISHABLE_KEY to <code>.env.local</code> (never commit
        it) and restart the dev server — see supabase/README.md §2.
      </p>
      <a className="gate-secondary" href="/">
        Back to the radio
      </a>
    </div>
  );
}

interface GateProps {
  busy: boolean;
  error: string | null;
  expired: boolean;
  onSubmit: (email: string) => void;
}

export function AccessGate({ busy, error, expired, onSubmit }: GateProps): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <div className="gate-card">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <h1 className="gate-title">Private access</h1>
      <p className="gate-copy">
        Enter your authorized email. Only authorized administrators can access
        this area.
      </p>
      {expired ? (
        <p className="gate-notice" role="status">
          Your admin session has expired. Verify your email again to continue.
        </p>
      ) : null}
      <form
        className="gate-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <label className="gate-label" htmlFor="admin-email">
          Email
        </label>
        <input
          id="admin-email"
          className="gate-input"
          type="email"
          autoComplete="email"
          spellCheck={false}
          required
          placeholder="admin@yourdomain.com"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        {error ? (
          <p className="gate-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="gate-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Continue'}
        </button>
      </form>
      <p className="gate-footnote">
        No password. A one-time code goes to your inbox — the database decides
        who gets in.
      </p>
    </div>
  );
}

interface OtpProps {
  maskedEmail: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  value: string;
  onChange: (code: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function OtpEntry({
  maskedEmail,
  busy,
  error,
  notice,
  value,
  onChange,
  onSubmit,
  onBack,
}: OtpProps): JSX.Element {
  return (
    <div className="gate-card">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <h1 className="gate-title">Check your email</h1>
      <p className="gate-copy">
        A verification code was sent to <strong>{maskedEmail}</strong>.
      </p>
      {notice ? (
        <p className="gate-notice" role="status">
          {notice}
        </p>
      ) : null}
      <form
        className="gate-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="gate-label" htmlFor="admin-code">
          Enter verification code
        </label>
        <input
          id="admin-code"
          className="gate-input gate-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="000000"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          disabled={busy}
          autoFocus
        />
        {error ? (
          <p className="gate-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="gate-primary" type="submit" disabled={busy || value.length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <div className="gate-alt">
        <button className="gate-secondary" type="button" onClick={onBack} disabled={busy}>
          Use a different email
        </button>
      </div>
    </div>
  );
}

export function AccessDenied({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="gate-card" role="alert">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <h1 className="gate-title">Access denied</h1>
      <p className="gate-copy">
        This email is not authorized to access the Nostalgia Radio
        administration system.
      </p>
      <button className="gate-primary" type="button" onClick={onRetry}>
        Try again
      </button>
      <p className="gate-footnote">
        No information is revealed about which addresses are authorized.
      </p>
    </div>
  );
}

function StatusCard({ label }: { label: string }): JSX.Element {
  return (
    <div className="gate-card" role="status" aria-busy="true">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <p className="gate-boot-line">{label}</p>
    </div>
  );
}

function DbError({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="gate-card" role="alert">
      <p className="gate-brand">NOSTALGIA RADIO</p>
      <h1 className="gate-title">Database not ready</h1>
      <p className="gate-copy">{message}</p>
      <button className="gate-primary" type="button" onClick={onRetry}>
        Retry
      </button>
      <a className="gate-secondary" href="/">
        Back to the radio
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The gate state machine                                              */
/* ------------------------------------------------------------------ */

export default function AdminApp(): JSX.Element {
  const configured = isSupabaseConfigured();
  const sb: SupabaseClient | null = useMemo(
    () => (configured ? getSupabase() : null),
    [configured],
  );

  const [phase, setPhase] = useState<Phase>(() => (configured ? 'boot' : 'unconfigured'));
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** Set while we sign out on purpose, so the listener doesn't read it as an
   *  unexpected session expiry. */
  const signingOutRef = useRef(false);
  /** Dedupes the access check (verify + SIGNED_IN listener can both fire). */
  const accessInFlight = useRef<Promise<boolean> | null>(null);

  /** The one server-side decision: does this identity hold an active
   *  admin_users row? Everything else in the panel is downstream of it. */
  const runAccessCheck = useCallback(
    (user: { id: string; email?: string | null }): Promise<boolean> => {
      if (!sb) return Promise.resolve(false);
      if (accessInFlight.current) return accessInFlight.current;

      setPhase('checking');
      const task = (async () => {
        const { data, error } = await sb.rpc('is_admin');
        if (error) {
          setFormError(mapDbError(error.code, error.message));
          setPhase('db-error');
          return false;
        }
        if (data !== true) {
          // Authorized ≠ allowed: sign the session out and show the same
          // refusal for every address (no enumeration).
          signingOutRef.current = true;
          try {
            await sb.auth.signOut();
          } finally {
            signingOutRef.current = false;
          }
          setIdentity(null);
          setPhase('denied');
          return false;
        }
        const { data: role } = await sb.rpc('admin_role');
        setIdentity({
          id: user.id,
          email: user.email ?? email,
          role: typeof role === 'string' && role ? role : 'admin',
        });
        setFormError(null);
        setPhase('ready');
        // Moves last_login_at, which the database's trigger records as a
        // "sign in" activity row. Non-blocking: the access decision is made.
        void sb
          .from('admin_users')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id);
        return true;
      })();

      const guarded = task.finally(() => {
        accessInFlight.current = null;
      });
      accessInFlight.current = guarded;
      return guarded;
    },
    [sb, email],
  );

  // Boot: restore a persisted session, or land on the gate.
  useEffect(() => {
    if (!sb) return;
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        if (cancelled) return;
        if (session) await runAccessCheck(session.user);
        else setPhase('gate');
      } catch {
        if (!cancelled) setPhase('gate');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, runAccessCheck]);

  // Session lifetime: an unexpected sign-out after entry means the session
  // expired (spec §85); a sign-in (e.g. magic-link click) starts the check.
  useEffect(() => {
    if (!sb) return;
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (signingOutRef.current) return;
        if (phaseRef.current === 'ready') {
          setIdentity(null);
          setPhase('expired');
        }
        return;
      }
      if (
        event === 'SIGNED_IN' &&
        session &&
        phaseRef.current !== 'ready' &&
        phaseRef.current !== 'checking'
      ) {
        void runAccessCheck(session.user);
      }
    });
    return () => subscription.unsubscribe();
  }, [sb, runAccessCheck]);

  const sendCode = useCallback(
    async (rawEmail: string) => {
      if (!sb) return;
      const normalized = rawEmail.trim().toLowerCase();
      if (!isValidEmail(normalized)) {
        setFormError('Enter a valid email address.');
        return;
      }
      setBusy(true);
      setFormError(null);
      try {
        const { error } = await sb.auth.signInWithOtp({
          email: normalized,
          options: { shouldCreateUser: true },
        });
        if (error) {
          setFormError(mapSendError(error.message));
          return;
        }
        setEmail(normalized);
        setCode('');
        setNotice('Verification code sent.');
        setPhase('otp');
      } catch {
        setFormError('Could not reach Supabase. Check your connection and try again.');
      } finally {
        setBusy(false);
      }
    },
    [sb],
  );

  const submitCode = useCallback(async () => {
    if (!sb) return;
    if (!/^\d{6}$/.test(code)) {
      setFormError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { data, error } = await sb.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      });
      if (error || !data.session) {
        setFormError(mapVerifyError(error?.message ?? ''));
        return;
      }
      // The listener may already be running the same check; accessInFlight
      // dedupes so last_login_at is written exactly once.
      await runAccessCheck(data.session.user);
    } catch {
      setFormError('Could not reach Supabase. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [sb, code, email, runAccessCheck]);

  const backToGate = useCallback(() => {
    setFormError(null);
    setNotice(null);
    setCode('');
    setPhase('gate');
  }, []);

  const retryDb = useCallback(async () => {
    if (!sb) return;
    setFormError(null);
    setPhase('checking');
    try {
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (session) await runAccessCheck(session.user);
      else setPhase('gate');
    } catch {
      setPhase('gate');
    }
  }, [sb, runAccessCheck]);

  const signOut = useCallback(async () => {
    signingOutRef.current = true;
    setIdentity(null);
    setPhase('gate');
    setCode('');
    setFormError(null);
    try {
      await sb?.auth.signOut();
    } finally {
      signingOutRef.current = false;
    }
  }, [sb]);

  /** A page saw 42501 mid-use — RLS says this identity no longer qualifies.
   *  Demote the UI and drop the session the database just refused. */
  const handleAccessLost = useCallback(() => {
    setIdentity(null);
    setPhase('denied');
    if (sb) {
      signingOutRef.current = true;
      void sb.auth
        .signOut()
        .catch(() => undefined)
        .finally(() => {
          signingOutRef.current = false;
        });
    }
  }, [sb]);

  // A configured-but-broken client (bad URL in .env.local) still lands here.
  if (!sb) return <Unconfigured />;

  switch (phase) {
    case 'unconfigured':
      return <Unconfigured />;
    case 'boot':
      return <StatusCard label="Restoring your session…" />;
    case 'checking':
      return <StatusCard label="Verifying admin access…" />;
    case 'gate':
      return (
        <AccessGate busy={busy} error={formError} expired={false} onSubmit={sendCode} />
      );
    case 'expired':
      return (
        <AccessGate busy={busy} error={formError} expired onSubmit={sendCode} />
      );
    case 'otp':
      return (
        <OtpEntry
          maskedEmail={maskEmail(email)}
          busy={busy}
          error={formError}
          notice={notice}
          value={code}
          onChange={setCode}
          onSubmit={() => void submitCode()}
          onBack={backToGate}
        />
      );
    case 'denied':
      return <AccessDenied onRetry={backToGate} />;
    case 'db-error':
      return <DbError message={formError ?? 'The database request failed.'} onRetry={() => void retryDb()} />;
    case 'ready':
      return identity ? (
        <AdminShell
          sb={sb}
          identity={identity}
          onSignOut={() => void signOut()}
          onAccessLost={handleAccessLost}
        />
      ) : (
        <StatusCard label="Verifying admin access…" />
      );
  }
}
