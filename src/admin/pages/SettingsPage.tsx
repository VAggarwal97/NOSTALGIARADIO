import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ErrorPanel, LoadingRow, formatWhen, pageErrorMessage } from '../pageSupport';
import type { SettingRow, SettingValueType } from '../adminTypes';

/**
 * Settings — full CRUD over `site_settings`, the site's key/value configuration
 * store (hero copy, donation link, SEO, maintenance flag). Values are validated
 * against their declared type before anything is sent, so a refused save is
 * always the database's answer, never a surprise. Secrets never belong here:
 * publicly_visible keys are readable by any visitor, and the panel itself is
 * open (no sign-in) — both tradeoffs are documented in supabase/README.md §9.
 */

const VALUE_TYPES: readonly SettingValueType[] = ['text', 'number', 'boolean', 'json'];

interface Props {
  sb: SupabaseClient;
}

interface Draft {
  setting_key: string;
  setting_value: string;
  value_type: SettingValueType;
  publicly_visible: boolean;
}

const draftFromRow = (row: SettingRow): Draft => ({
  setting_key: row.setting_key,
  setting_value: row.setting_value,
  value_type: row.value_type,
  publicly_visible: row.publicly_visible,
});

/** Type-aware validation — the exact sentence the admin sees on failure. */
const validateDraft = (draft: Draft): string | null => {
  if (draft.setting_value.length > 2000) {
    return 'Keep the value under 2000 characters — the database refuses longer rows.';
  }
  if (draft.value_type === 'boolean' && draft.setting_value !== 'true' && draft.setting_value !== 'false') {
    return 'A boolean setting is exactly "true" or "false".';
  }
  if (draft.value_type === 'number' && !Number.isFinite(Number(draft.setting_value.trim()))) {
    return 'A number setting needs a plain number, e.g. 42.';
  }
  if (draft.value_type === 'json') {
    try {
      JSON.parse(draft.setting_value);
    } catch {
      return 'That value is not valid JSON.';
    }
  }
  return null;
};

const draftDiffers = (row: SettingRow, draft: Draft): boolean =>
  row.setting_value !== draft.setting_value ||
  row.value_type !== draft.value_type ||
  row.publicly_visible !== draft.publicly_visible;

export function SettingsPage({ sb }: Props): JSX.Element {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editError, setEditError] = useState<{ key: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await sb
      .from('site_settings')
      .select('*')
      .order('setting_key');
    if (fetchError) {
      setError(pageErrorMessage(fetchError));
      setRows(null);
      return;
    }
    const list = (data ?? []) as unknown as SettingRow[];
    setRows(list);
    setDrafts(Object.fromEntries(list.map((row) => [row.setting_key, draftFromRow(row)])));
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftFor = (row: SettingRow): Draft => drafts[row.setting_key] ?? draftFromRow(row);

  const setDraft = (key: string, patch: Partial<Draft>): void => {
    setDrafts((current) => {
      const base = current[key];
      if (!base) return current; // drafts are seeded from load(); the table only renders after it
      return { ...current, [key]: { ...base, ...patch } };
    });
    setEditError(null);
  };

  const save = async (row: SettingRow): Promise<void> => {
    const draft = draftFor(row);
    const problem = validateDraft(draft);
    if (problem) {
      setEditError({ key: row.setting_key, text: problem });
      return;
    }
    setBusyKey(row.setting_key);
    setEditError(null);
    const { error: updateError } = await sb
      .from('site_settings')
      .update({
        setting_value: draft.setting_value,
        value_type: draft.value_type,
        publicly_visible: draft.publicly_visible,
      })
      .eq('setting_key', row.setting_key);
    setBusyKey(null);
    if (updateError) {
      setEditError({ key: row.setting_key, text: pageErrorMessage(updateError) });
      return;
    }
    setMessage(`Saved “${row.setting_key}” — public settings apply to the live site automatically.`);
    await load();
  };

  const remove = async (key: string): Promise<void> => {
    setBusyKey(key);
    setEditError(null);
    const { error: deleteError } = await sb.from('site_settings').delete().eq('setting_key', key);
    setBusyKey(null);
    setConfirmKey(null);
    if (deleteError) {
      setEditError({ key, text: pageErrorMessage(deleteError) });
      return;
    }
    setMessage(`Deleted “${key}” — the site drops it automatically.`);
    await load();
  };

  const add = async (): Promise<void> => {
    if (!adding) return;
    const key = adding.setting_key.trim();
    if (!/^[a-z0-9_]{1,64}$/.test(key)) {
      setEditError({ key: '(new)', text: 'Keys use lowercase letters, numbers and underscores (max 64).' });
      return;
    }
    if (rows?.some((row) => row.setting_key === key)) {
      setEditError({ key: '(new)', text: `“${key}” already exists — edit it below instead.` });
      return;
    }
    const problem = validateDraft(adding);
    if (problem) {
      setEditError({ key: '(new)', text: problem });
      return;
    }
    setBusyKey('(new)');
    setEditError(null);
    const { error: insertError } = await sb.from('site_settings').insert({
      setting_key: key,
      setting_value: adding.setting_value,
      value_type: adding.value_type,
      publicly_visible: adding.publicly_visible,
    });
    setBusyKey(null);
    if (insertError) {
      setEditError({ key: '(new)', text: pageErrorMessage(insertError) });
      return;
    }
    setAdding(null);
    setMessage(`Added “${key}” — public settings apply to the live site automatically.`);
    await load();
  };

  if (error && !rows) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!rows) return <LoadingRow label="Loading site settings…" />;

  return (
    <div className="admin-page">
      <div className="admin-quick">
        <button
          className="admin-primary-sm"
          type="button"
          onClick={() =>
            setAdding({
              setting_key: '',
              setting_value: '',
              value_type: 'text',
              publicly_visible: false,
            })
          }
          disabled={adding !== null}
        >
          New setting
        </button>
      </div>

      <p className="admin-status-line" role="status" aria-live="polite">
        {message ?? ''}
      </p>

      {editError ? (
        <div className="admin-panel admin-error" role="alert">
          <p>
            <strong>{editError.key}:</strong> {editError.text}
          </p>
        </div>
      ) : null}

      {adding ? (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <h2 className="admin-panel-title">New setting</h2>
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field-label" htmlFor="new-setting-key">
                Key *
              </label>
              <input
                id="new-setting-key"
                className="admin-input"
                type="text"
                spellCheck={false}
                placeholder="donation_url"
                value={adding.setting_key}
                onChange={(event) =>
                  setAdding({ ...adding, setting_key: event.target.value })
                }
              />
              <p className="admin-field-hint">Lowercase letters, numbers, underscores.</p>
            </div>
            <div className="admin-field">
              <label className="admin-field-label" htmlFor="new-setting-value">
                Value *
              </label>
              <input
                id="new-setting-value"
                className="admin-input"
                type="text"
                value={adding.setting_value}
                onChange={(event) =>
                  setAdding({ ...adding, setting_value: event.target.value })
                }
              />
            </div>
            <div className="admin-field">
              <label className="admin-field-label" htmlFor="new-setting-type">
                Type
              </label>
              <select
                id="new-setting-type"
                className="admin-select"
                value={adding.value_type}
                onChange={(event) =>
                  setAdding({
                    ...adding,
                    value_type: event.target.value as SettingValueType,
                  })
                }
              >
                {VALUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={adding.publicly_visible}
                onChange={(event) =>
                  setAdding({ ...adding, publicly_visible: event.target.checked })
                }
              />
              Publicly visible (the public site may read this key)
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="admin-primary-sm" type="submit" disabled={busyKey === '(new)'}>
              {busyKey === '(new)' ? 'Saving…' : 'Add setting'}
            </button>
            <button className="admin-ghost" type="button" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="admin-panel admin-empty">
          <p>No settings yet.</p>
          <p className="admin-note">Add the first key with “New setting”.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Value</th>
                <th scope="col">Type</th>
                <th scope="col">Public</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = draftFor(row);
                const busy = busyKey === row.setting_key;
                const dirty = draftDiffers(row, draft);
                return (
                  <tr key={row.setting_key}>
                    <td>
                      <span className="admin-cell-title">{row.setting_key}</span>
                    </td>
                    <td>
                      <input
                        className="admin-input admin-input-wide"
                        type="text"
                        aria-label={`Value for ${row.setting_key}`}
                        value={draft.setting_value}
                        onChange={(event) =>
                          setDraft(row.setting_key, { setting_value: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="admin-select"
                        aria-label={`Type for ${row.setting_key}`}
                        value={draft.value_type}
                        onChange={(event) =>
                          setDraft(row.setting_key, {
                            value_type: event.target.value as SettingValueType,
                          })
                        }
                      >
                        {VALUE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${row.setting_key} publicly visible`}
                        checked={draft.publicly_visible}
                        onChange={(event) =>
                          setDraft(row.setting_key, {
                            publicly_visible: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>{formatWhen(row.updated_at)}</td>
                    <td className="admin-row-actions">
                      {confirmKey === row.setting_key ? (
                        <>
                          <span className="admin-confirm-text">
                            Delete “{row.setting_key}”? Anything reading it falls
                            back to its code default.
                          </span>
                          <button
                            type="button"
                            className="admin-danger"
                            disabled={busy}
                            onClick={() => void remove(row.setting_key)}
                          >
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            className="admin-ghost"
                            onClick={() => setConfirmKey(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="admin-primary-sm"
                            disabled={busy || !dirty}
                            onClick={() => void save(row)}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="admin-danger"
                            disabled={busy}
                            onClick={() => setConfirmKey(row.setting_key)}
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
        Never store secrets here: <strong>publicly_visible</strong> keys are
        readable by any visitor, and this panel has no sign-in. The public site
        still renders most copy from its code — the remaining key-to-site wiring
        is tracked in ROADMAP.md, and every save above lands in the activity log.
      </p>
    </div>
  );
}
