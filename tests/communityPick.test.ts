import { describe, expect, it } from 'vitest';
import { COMMUNITY_PICK, communityPick } from '../src/lib/community-pick';

describe('community pick — honest copy for the on-air request', () => {
  it('claims nothing when no request is on air', () => {
    const none = { label: null, votes: null, helped: false };
    expect(communityPick(null, () => true)).toEqual(none);
    expect(communityPick(undefined, () => true)).toEqual(none);
  });

  it('labels a loaded request as the community pick', () => {
    expect(communityPick({ id: 'r1', votes: 0 }, () => false).label).toBe(COMMUNITY_PICK);
    expect(COMMUNITY_PICK).toBe('Community pick');
  });

  it('never claims a vote count nobody cast', () => {
    expect(communityPick({ id: 'r1', votes: 0 }, () => false).votes).toBeNull();
    expect(communityPick({ id: 'r1', votes: 7 }, () => false).votes).toBe(7);
  });

  it('reports "you helped" only from this device’s own vote', () => {
    const votedFor = (id: string) => id === 'r7';
    expect(communityPick({ id: 'r7', votes: 3 }, votedFor).helped).toBe(true);
    expect(communityPick({ id: 'r9', votes: 3 }, votedFor).helped).toBe(false);
  });
});
