import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, pageErrorMessage } from '../pageSupport';
import type { CategoryRow, StationRow, SongRow } from '../adminTypes';

/**
 * Catalogue — full CRUD over categories, stations and songs, the tables the
 * moderation targets and the station catalogue live in. Every value is
 * coerced and checked against the schema's own rules before a write is sent,
 * so a refused save is always the database's answer. Deleting is honest
 * about cascades: a station takes its songs and station votes with it.
 */

type Tab = 'stations' | 'categories' | 'songs';

type Values = Record<string, string | boolean>;

interface Option {
  value: string;
  label: string;
}

interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'tags' | 'accent';
  options?: Option[];
  /** Empty value is refused before the write (NOT NULL columns without a usable default). */
  required?: boolean;
  /** false → an empty string omits the column entirely (keep the default/current value). */
  nullable?: boolean;
  pattern?: 'slug' | 'localOrHttps' | 'https';
  hint?: string;
}

interface Props {
  sb: SupabaseClient;
}

type AnyRow = CategoryRow | StationRow | SongRow;

const NONE: Option = { value: '', label: '— none —' };
const PROVIDER_OPTIONS: readonly Option[] = [
  NONE,
  { value: 'youtube', label: 'youtube' },
  { value: 'spotify', label: 'spotify' },
];

const TAB_LABELS: Record<Tab, string> = {
  stations: 'Stations',
  categories: 'Categories',
  songs: 'Songs',
};

const SINGULAR: Record<Tab, string> = {
  stations: 'station',
  categories: 'category',
  songs: 'song',
};

/** Sentinel: leave the column out of the payload entirely. */
const OMIT = Symbol('omit');

const categoryFields: FieldSpec[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'text', required: true, pattern: 'slug' },
  { key: 'tagline', label: 'Tagline', type: 'textarea' },
  { key: 'icon', label: 'Icon (emoji)', type: 'text', hint: 'Up to 8 characters.' },
  { key: 'accent', label: 'Accent', type: 'accent', hint: 'Hex color like #c96f4a.' },
  { key: 'image_url', label: 'Image URL', type: 'text' },
  { key: 'flagship_slug', label: 'Flagship station slug', type: 'text' },
  { key: 'sort_order', label: 'Sort order', type: 'number', nullable: false },
  { key: 'active', label: 'Active (visible on the site)', type: 'boolean' },
];

const stationFields = (categories: Option[]): FieldSpec[] => [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'text', required: true, pattern: 'slug' },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'category_id',
    label: 'Category',
    type: 'select',
    options: [NONE, ...categories],
  },
  { key: 'region', label: 'Region', type: 'text' },
  { key: 'era', label: 'Era', type: 'text' },
  { key: 'language', label: 'Languages', type: 'tags', hint: 'Comma-separated: Hindi, Punjabi' },
  { key: 'tags', label: 'Tags', type: 'tags', hint: 'Comma-separated.' },
  {
    key: 'artwork_url',
    label: 'Artwork URL',
    type: 'text',
    pattern: 'localOrHttps',
    hint: 'A local path (/art/…) or an https:// URL.',
  },
  { key: 'accent', label: 'Accent', type: 'accent', hint: 'Hex color like #c96f4a.' },
  { key: 'source_url', label: 'Source URL', type: 'text', pattern: 'https' },
  { key: 'audio_url', label: 'Audio URL', type: 'text' },
  { key: 'provider', label: 'Provider', type: 'select', options: [...PROVIDER_OPTIONS] },
  {
    key: 'playlist_url',
    label: 'Playlist URL',
    type: 'text',
    hint: 'Travels with the provider — set both or clear both.',
  },
  {
    key: 'action',
    label: 'Action',
    type: 'select',
    nullable: false,
    options: [
      { value: 'check', label: 'check' },
      { value: 'play', label: 'play' },
    ],
  },
  {
    key: 'source_type',
    label: 'Source type',
    type: 'select',
    nullable: false,
    options: [
      { value: 'external-site', label: 'external-site' },
      { value: 'direct-audio', label: 'direct-audio' },
      { value: 'embed', label: 'embed' },
    ],
  },
  {
    key: 'status',
    label: 'Stream status',
    type: 'select',
    nullable: false,
    options: [
      { value: 'ready', label: 'ready' },
      { value: 'offline', label: 'offline' },
      { value: 'unknown', label: 'unknown' },
    ],
  },
  { key: 'now_playing_title', label: 'Now playing — title', type: 'text' },
  { key: 'now_playing_subtitle', label: 'Now playing — subtitle', type: 'text' },
  { key: 'sort_order', label: 'Sort order', type: 'number', nullable: false },
  { key: 'active', label: 'Active (visible on the site)', type: 'boolean' },
  { key: 'featured', label: 'Featured', type: 'boolean' },
  { key: 'flagship', label: 'Flagship', type: 'boolean' },
  { key: 'demo', label: 'Demo station', type: 'boolean' },
];

const songFields = (stations: Option[]): FieldSpec[] => [
  { key: 'station_id', label: 'Station', type: 'select', required: true, options: stations },
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'artist', label: 'Artist', type: 'text' },
  { key: 'album', label: 'Album', type: 'text' },
  { key: 'year', label: 'Year', type: 'number', hint: '1850–2100.' },
  { key: 'language', label: 'Language', type: 'text' },
  { key: 'duration_sec', label: 'Duration (seconds)', type: 'number' },
  { key: 'audio_url', label: 'Audio URL', type: 'text' },
  { key: 'artwork_url', label: 'Artwork URL', type: 'text' },
  { key: 'provider', label: 'Provider', type: 'select', options: [...PROVIDER_OPTIONS] },
  { key: 'provider_id', label: 'Provider track ID', type: 'text' },
  {
    key: 'source_type',
    label: 'Source type',
    type: 'select',
    nullable: false,
    options: [
      { value: 'direct-audio', label: 'direct-audio' },
      { value: 'hls', label: 'hls' },
      { value: 'stream', label: 'stream' },
      { value: 'youtube', label: 'youtube' },
      { value: 'spotify', label: 'spotify' },
    ],
  },
  { key: 'sort_order', label: 'Sort order', type: 'number', nullable: false },
  { key: 'active', label: 'Active', type: 'boolean' },
];

type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

/** One field, one honest rule — mirrors the schema's CHECKs client-side. */
const coerceValue = (field: FieldSpec, raw: string | boolean): CoerceResult => {
  if (field.type === 'boolean') return { ok: true, value: raw === true };

  const text = String(raw).trim();
  if (!text) {
    if (field.required) return { ok: false, error: `${field.label} is required.` };
    if (field.nullable === false) return { ok: true, value: OMIT };
    return { ok: true, value: null };
  }

  if (field.type === 'number') {
    const n = Number(text);
    if (!Number.isInteger(n)) return { ok: false, error: `${field.label} must be a whole number.` };
    if (field.key === 'sort_order' && n < 0) {
      return { ok: false, error: 'Sort order cannot be negative.' };
    }
    if (field.key === 'year' && (n < 1850 || n > 2100)) {
      return { ok: false, error: 'Year must be between 1850 and 2100.' };
    }
    return { ok: true, value: n };
  }

  if (field.type === 'tags') {
    return { ok: true, value: text.split(',').map((tag) => tag.trim()).filter(Boolean) };
  }

  if (field.type === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(text)) {
    return { ok: false, error: `${field.label} must look like #c96f4a.` };
  }
  if (field.pattern === 'slug' && !/^[a-z0-9-]+$/.test(text)) {
    return { ok: false, error: `${field.label} uses lowercase letters, numbers and dashes.` };
  }
  if (field.pattern === 'https' && !text.startsWith('https://')) {
    return { ok: false, error: `${field.label} must start with https://.` };
  }
  if (
    field.pattern === 'localOrHttps' &&
    !text.startsWith('/') &&
    !text.startsWith('https://')
  ) {
    return { ok: false, error: `${field.label} must be a local path (/…) or an https:// URL.` };
  }
  return { ok: true, value: text };
};

const valuesFromRow = (fields: FieldSpec[], row: AnyRow): Values => {
  const source = row as unknown as Record<string, unknown>;
  const values: Values = {};
  for (const field of fields) {
    const value = source[field.key];
    if (field.type === 'boolean') {
      values[field.key] = value === true;
    } else if (field.type === 'tags') {
      values[field.key] = Array.isArray(value) ? value.join(', ') : '';
    } else if (value === null || value === undefined) {
      values[field.key] = '';
    } else {
      values[field.key] = String(value);
    }
  }
  return values;
};

const newValues = (fields: FieldSpec[]): Values => {
  const values: Values = {};
  for (const field of fields) {
    if (field.type === 'boolean') values[field.key] = field.key === 'active';
    else if (field.key === 'action') values[field.key] = 'check';
    else if (field.key === 'source_type') {
      values[field.key] = field.nullable === false ? 'direct-audio' : '';
      if (field.options?.some((option) => option.value === 'external-site')) {
        values[field.key] = 'external-site';
      }
    } else if (field.key === 'status') values[field.key] = 'unknown';
    else values[field.key] = '';
  }
  return values;
};

const displayName = (tab: Tab, values: Values): string =>
  String(values.title || values.name || '(untitled)');

export function CataloguePage({ sb }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('stations');
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit'; id?: string; values: Values } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const categoryOptions = useMemo<Option[]>(
    () =>
      [...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ value: row.id, label: row.name })),
    [categories],
  );
  const stationOptions = useMemo<Option[]>(
    () =>
      [...stations]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((row) => ({ value: row.id, label: row.title })),
    [stations],
  );

  const fields = useMemo<FieldSpec[]>(
    () =>
      tab === 'categories'
        ? categoryFields
        : tab === 'stations'
          ? stationFields(categoryOptions)
          : songFields(stationOptions),
    [tab, categoryOptions, stationOptions],
  );

  // Foreign-key options load once: the station and song forms need them even
  // before their own tab has been opened.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [catResult, stationResult] = await Promise.all([
        sb.from('categories').select('id, name').order('name'),
        sb.from('stations').select('id, title').order('title'),
      ]);
      if (cancelled) return;
      if (!catResult.error) setCategories((catResult.data ?? []) as unknown as CategoryRow[]);
      if (!stationResult.error) setStations((stationResult.data ?? []) as unknown as StationRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [sb]);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    const query =
      tab === 'categories'
        ? sb.from('categories').select('*').order('sort_order').order('created_at')
        : tab === 'stations'
          ? sb.from('stations').select('*').order('sort_order').order('created_at')
          : sb.from('songs').select('*').order('sort_order').order('created_at').limit(200);
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(pageErrorMessage(fetchError));
      return;
    }
    setRows((data ?? []) as unknown as AnyRow[]);
  }, [sb, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTab = (next: Tab): void => {
    setTab(next);
    setEditing(null);
    setFormError(null);
    setConfirmId(null);
    setMessage(null);
  };

  const startEdit = (row: AnyRow): void => {
    setEditing({ mode: 'edit', id: row.id, values: valuesFromRow(fields, row) });
    setFormError(null);
    setConfirmId(null);
  };

  const startNew = (): void => {
    setEditing({ mode: 'new', values: newValues(fields) });
    setFormError(null);
    setConfirmId(null);
  };

  const setFieldValue = (key: string, value: string | boolean): void => {
    setEditing((current) =>
      current ? { ...current, values: { ...current.values, [key]: value } } : current,
    );
    setFormError(null);
  };

  const saveEditing = async (): Promise<void> => {
    if (!editing) return;
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const result = coerceValue(field, editing.values[field.key] ?? '');
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      if (result.value !== OMIT) payload[field.key] = result.value;
    }
    if (tab === 'stations' && Boolean(payload.provider) !== Boolean(payload.playlist_url)) {
      setFormError('A provider and its playlist link travel together — set both or clear both.');
      return;
    }

    setBusy(true);
    setFormError(null);
    const { error: writeError } =
      editing.mode === 'new'
        ? await sb.from(tab).insert(payload)
        : await sb.from(tab).update(payload).eq('id', editing.id);
    setBusy(false);
    if (writeError) {
      setFormError(pageErrorMessage(writeError));
      return;
    }
    const verb = editing.mode === 'new' ? 'Added' : 'Saved';
    setMessage(`${verb} “${displayName(tab, editing.values)}”.`);
    setEditing(null);
    await load();
  };

  const removeRow = async (row: AnyRow): Promise<void> => {
    setBusy(true);
    setFormError(null);
    const { error: deleteError } = await sb.from(tab).delete().eq('id', row.id);
    setBusy(false);
    setConfirmId(null);
    if (deleteError) {
      setError(pageErrorMessage(deleteError));
      return;
    }
    const label =
      tab === 'categories'
        ? (row as CategoryRow).name
        : tab === 'stations'
          ? (row as StationRow).title
          : (row as SongRow).title;
    setMessage(`Deleted “${label}”.`);
    await load();
  };

  const deleteCopy = (row: AnyRow): string => {
    if (tab === 'categories') {
      return `Delete “${(row as CategoryRow).name}”? Stations keep their rows but lose this chip.`;
    }
    if (tab === 'stations') {
      return `Delete “${(row as StationRow).title}”? Its songs are removed and station votes go with it.`;
    }
    return `Delete “${(row as SongRow).title}”?`;
  };

  if (error && !rows) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!rows) return <LoadingRow label={`Loading ${TAB_LABELS[tab].toLowerCase()}…`} />;

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="group" aria-label="Catalogue sections">
        {(Object.keys(TAB_LABELS) as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${tab === id ? ' admin-tab-on' : ''}`}
            aria-pressed={tab === id}
            onClick={() => switchTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="admin-quick">
        <button className="admin-primary-sm" type="button" onClick={startNew}>
          New {SINGULAR[tab]}
        </button>
      </div>

      <p className="admin-status-line" role="status" aria-live="polite">
        {message ?? ''}
      </p>

      {formError && editing ? (
        <div className="admin-panel admin-error" role="alert">
          <p>{formError}</p>
        </div>
      ) : null}

      {error && rows ? (
        <div className="admin-panel admin-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {editing ? (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEditing();
          }}
        >
          <h2 className="admin-panel-title">
            {editing.mode === 'new'
              ? `New ${SINGULAR[tab]}`
              : `Edit “${displayName(tab, editing.values)}”`}
          </h2>
          <div className="admin-form-grid">
            {fields.map((field) => {
              const id = `cat-${field.key}`;
              const value = editing.values[field.key] ?? '';
              return (
                <div
                  key={field.key}
                  className={`admin-field${field.type === 'textarea' ? ' admin-field-wide' : ''}`}
                >
                  {field.type === 'boolean' ? (
                    <label className="admin-check" htmlFor={id}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => setFieldValue(field.key, event.target.checked)}
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label className="admin-field-label" htmlFor={id}>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          id={id}
                          className="admin-textarea"
                          rows={3}
                          value={String(value)}
                          onChange={(event) => setFieldValue(field.key, event.target.value)}
                        />
                      ) : field.type === 'select' ? (
                        <select
                          id={id}
                          className="admin-select"
                          value={String(value)}
                          onChange={(event) => setFieldValue(field.key, event.target.value)}
                        >
                          {(field.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          className="admin-input"
                          type="text"
                          inputMode={field.type === 'number' ? 'numeric' : undefined}
                          spellCheck={false}
                          value={String(value)}
                          onChange={(event) => setFieldValue(field.key, event.target.value)}
                        />
                      )}
                      {field.hint ? <p className="admin-field-hint">{field.hint}</p> : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="admin-form-actions">
            <button className="admin-primary-sm" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              className="admin-ghost"
              type="button"
              onClick={() => {
                setEditing(null);
                setFormError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="admin-panel admin-empty">
          <p>No {TAB_LABELS[tab].toLowerCase()} yet.</p>
          <p className="admin-note">Add the first one with “New {SINGULAR[tab]}”.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{tab === 'categories' ? 'Name' : 'Title'}</th>
                <th scope="col">{tab === 'songs' ? 'Station' : 'Slug'}</th>
                <th scope="col" className="admin-num">
                  Order
                </th>
                <th scope="col">Active</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busyRow = busy && confirmId === row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="admin-cell-title">
                        {tab === 'categories'
                          ? (row as CategoryRow).name
                          : tab === 'stations'
                            ? (row as StationRow).title
                            : (row as SongRow).title}
                      </span>
                      {tab === 'songs' ? (
                        (row as SongRow).artist ? (
                          <span className="admin-cell-muted"> · {(row as SongRow).artist}</span>
                        ) : null
                      ) : null}
                    </td>
                    <td>
                      {tab === 'songs'
                        ? (stations.find((station) => station.id === (row as SongRow).station_id)
                            ?.title ?? '—')
                        : tab === 'categories'
                          ? (row as CategoryRow).slug
                          : (row as StationRow).slug}
                    </td>
                    <td className="admin-num">
                      {tab === 'categories'
                        ? (row as CategoryRow).sort_order
                        : tab === 'stations'
                          ? (row as StationRow).sort_order
                          : (row as SongRow).sort_order}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Active"
                        checked={
                          tab === 'categories'
                            ? (row as CategoryRow).active
                            : tab === 'stations'
                              ? (row as StationRow).active
                              : (row as SongRow).active
                        }
                        onChange={(event) => {
                          const active = event.target.checked;
                          const label =
                            tab === 'categories'
                              ? (row as CategoryRow).name
                              : tab === 'stations'
                                ? (row as StationRow).title
                                : (row as SongRow).title;
                          void (async () => {
                            const { error: toggleError } = await sb
                              .from(tab)
                              .update({ active })
                              .eq('id', row.id);
                            if (toggleError) {
                              setError(pageErrorMessage(toggleError));
                              return;
                            }
                            setMessage(`“${label}” is now ${active ? 'active' : 'inactive'}.`);
                            await load();
                          })();
                        }}
                      />
                    </td>
                    <td className="admin-row-actions">
                      {confirmId === row.id ? (
                        <>
                          <span className="admin-confirm-text">{deleteCopy(row)}</span>
                          <button
                            type="button"
                            className="admin-danger"
                            disabled={busy}
                            onClick={() => void removeRow(row)}
                          >
                            {busyRow ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            className="admin-ghost"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="admin-ghost"
                            disabled={busy}
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-danger"
                            disabled={busy}
                            onClick={() => setConfirmId(row.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin-note">
        Every save lands in the database immediately and appears in the activity
        log. Rows were seeded from the site’s code (<code>npm run seed:sql</code>);
        the public gallery still renders from that code until catalogue wiring
        ships (ROADMAP.md). Deleting a station cascades to its songs and its
        station votes — the confirm text says so first.
      </p>
    </div>
  );
}
