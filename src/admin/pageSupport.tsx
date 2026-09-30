import type { PostgrestError } from '@supabase/supabase-js';
import { mapDbError } from './gateUtils';

/** Shared loading/error furniture for admin pages — honest states only
 *  (spec §80: say what failed, that nothing changed, and offer a retry). */

export const pageErrorMessage = (
  error: PostgrestError,
  onAccessLost: () => void,
): string => {
  if (error.code === '42501') {
    // RLS refused: the database no longer considers this identity an admin.
    onAccessLost();
    return 'Not authorized.';
  }
  return mapDbError(error.code, error.message);
};

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
