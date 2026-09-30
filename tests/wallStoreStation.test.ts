/**
 * Station stamp: bundled station ids are text slugs, the column is uuid.
 * The wall store resolves slug → uuid before insert (production bug: a raw
 * slug reached the uuid column → Postgres 22P02 → the submit reported the
 * generic wall failure). The stamp stays optional: unknown slug, failed
 * lookup, or null all insert NULL — never a blocked submission.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseWallStore } from '../src/lib/supabase-wall-store';
import type { NewSuggestion } from '../src/lib/wall-store';

const TRUCK_WALA_UUID = '9f24a8bf-2931-4911-b08c-d0fb4dbba31c';

interface FakeOptions {
  stations: Array<{ id: string; slug: string }>;
  lookupError?: { code: string; message: string };
}

function fakeClient(options: FakeOptions) {
  const inserts: Array<Record<string, unknown>> = [];
  let slugLookups = 0;

  const client = {
    from(table: string) {
      if (table === 'stations') {
        return {
          select(_columns: string) {
            return {
              eq(column: string, value: string) {
                if (column !== 'slug') throw new Error(`unexpected stations filter: ${column}`);
                return {
                  async maybeSingle() {
                    slugLookups += 1;
                    if (options.lookupError) return { data: null, error: options.lookupError };
                    const hit = options.stations.find((station) => station.slug === value);
                    return { data: hit ? { id: hit.id } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'suggestions') {
        return {
          insert(payload: Record<string, unknown>) {
            inserts.push(payload);
            return {
              select(_columns: string) {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        ...payload,
                        id: 'inserted-row-1',
                        status: 'approved',
                        played_at: null,
                        created_at: '2026-10-01T00:00:00+00:00',
                        updated_at: '2026-10-01T00:00:00+00:00',
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return {
    store: createSupabaseWallStore(client as unknown as SupabaseClient),
    inserts,
    lookups: () => slugLookups,
  };
}

const newRow = (station_id: string | null): NewSuggestion => ({
  song_url: 'https://www.youtube.com/watch?v=G8wCaZ2Kok8',
  provider: 'youtube',
  provider_id: 'G8wCaZ2Kok8',
  title: 'Halka Halka Saroor',
  artist: 'Nusrat Fateh Ali Khan',
  artwork_url: null,
  station_id,
  visitor_token: 'visitor-token-for-tests',
});

describe('suggestion station stamp — slug → uuid', () => {
  it('resolves a bundled slug to the station uuid on insert', async () => {
    const harness = fakeClient({
      stations: [{ id: TRUCK_WALA_UUID, slug: 'truck-wala-radio' }],
    });
    const row = await harness.store.insertSuggestion(newRow('truck-wala-radio'));

    expect(harness.inserts).toHaveLength(1);
    expect(harness.inserts[0].station_id).toBe(TRUCK_WALA_UUID);
    expect(harness.lookups()).toBe(1);
    expect(row.id).toBe('inserted-row-1'); // the public confirm-read still succeeds
    expect(harness.inserts[0]).not.toHaveProperty('status'); // the browser never dictates it
  });

  it('passes an already-uuid id through without any lookup', async () => {
    const harness = fakeClient({ stations: [] });
    await harness.store.insertSuggestion(newRow(TRUCK_WALA_UUID));

    expect(harness.inserts[0].station_id).toBe(TRUCK_WALA_UUID);
    expect(harness.lookups()).toBe(0);
  });

  it('inserts null when there is no station context', async () => {
    const harness = fakeClient({ stations: [] });
    await harness.store.insertSuggestion(newRow(null));

    expect(harness.inserts[0].station_id).toBeNull();
    expect(harness.lookups()).toBe(0);
  });

  it('falls back to null for an unknown slug and remembers the miss', async () => {
    const harness = fakeClient({ stations: [] });
    await harness.store.insertSuggestion(newRow('ghost-station'));
    await harness.store.insertSuggestion(newRow('ghost-station'));

    expect(harness.inserts[0].station_id).toBeNull();
    expect(harness.inserts[1].station_id).toBeNull();
    expect(harness.lookups()).toBe(1); // the miss is cached, not re-queried
  });

  it('still submits when the lookup errors, and retries it next time', async () => {
    const harness = fakeClient({
      stations: [],
      lookupError: { code: '57P01', message: 'admin shutdown in progress' },
    });
    await harness.store.insertSuggestion(newRow('truck-wala-radio'));
    await harness.store.insertSuggestion(newRow('truck-wala-radio'));

    expect(harness.inserts).toHaveLength(2); // the request is never blocked by a stamp
    expect(harness.inserts[0].station_id).toBeNull();
    expect(harness.lookups()).toBe(2); // transient failures are not cached
  });
});
