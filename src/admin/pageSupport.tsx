import type { PostgrestError } from '@supabase/supabase-js';
import { mapDbError } from './adminErrors';

/** Shared loading/error furniture for admin pages — honest states only
 *  (say what failed, that nothing changed, and offer a retry). With the
 *  panel open there is no session to lose: every database refusal maps to
 *  the database's own sentence. */

export const pageErrorMessage = (error: PostgrestError): string =>
  mapDbError(error.code, error.message);

export function LoadingRow({ label }: { label: string }): JSX.Element {
  return (
    <p className="admin-loading" role="status">
      {label}
    </p>
  );
}

export function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="admin-panel admin-error" role="alert">
      <p>{message}</p>
      <button className="admin-ghost" type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** Client-side only (these pages render after hydration, in the browser). */
export const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
