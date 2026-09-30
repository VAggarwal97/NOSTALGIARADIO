/** Row shapes the admin panel reads — kept hand-written on purpose (the
 *  Supabase client is untyped; these describe what the migrations define). */

export interface AdminIdentity {
  /** auth.users id — the verified Supabase Auth identity. */
  id: string;
  email: string;
  /** Row from admin_users: owner | admin | editor | moderator. */
  role: string;
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'played';

export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = [
  'pending',
  'approved',
  'rejected',
  'played',
];

/** What the public reads through the token-free `request_wall` view. */
export interface SuggestionRow {
  id: string;
  song_url: string | null;
  title: string;
  artist: string | null;
  description: string | null;
  artwork_url: string | null;
  status: SuggestionStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface ActivityRow {
  id: string;
  admin_email: string | null;
  action: string;
  entity_type: string | null;
  entity_label: string | null;
  created_at: string;
}
