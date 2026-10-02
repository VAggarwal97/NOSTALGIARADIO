/**
 * Community Pick — the copy that labels a request from the wall while it is on
 * air (pill, engine dock, expanded player and the wall card share one source).
 *
 * Honesty rules live here so every surface inherits them:
 *  - the label exists only while a request exists — a station never wears it;
 *  - the vote count is published only when at least one real vote exists
 *    (same rule as the wall counters: "0 requested" is never claimed);
 *  - "you helped" is this device's own remembered vote (`community-identity`),
 *    never a server inference about who the listener is.
 */
export const COMMUNITY_PICK = 'Community pick';

export interface CommunityPick {
  /** Null when nothing from the community is on air. */
  label: string | null;
  /** Honest aggregate — null while nobody has actually voted. */
  votes: number | null;
  /** True when this device's vote is part of what put the request on air. */
  helped: boolean;
}

export function communityPick(
  request: { id: string; votes: number } | null | undefined,
  hasVoted: (requestId: string) => boolean,
): CommunityPick {
  if (!request) return { label: null, votes: null, helped: false };
  return {
    label: COMMUNITY_PICK,
    votes: request.votes > 0 ? request.votes : null,
    helped: hasVoted(request.id),
  };
}
