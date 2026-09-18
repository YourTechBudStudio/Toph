import { useEffect, useMemo, useState } from 'react';

import type {
  ProviderConnection,
  ProviderFieldSpec,
  ProviderFieldValue,
  ProviderSettingsValues,
} from '@toph/desktop-contracts';

import { Button } from '../button';
import { ProviderFieldControl } from './provider-field-controls';
import { SettingsRow } from './settings-controls';

/**
 * The expanded body of a provider card: description, error, the declared credential fields, the
 * submit and remove actions, and the provider-group settings. An OAuth provider declares no
 * credential fields, so the same code renders it as the submit button alone — this switches on
 * `auth.kind` only, never on the provider id.
 *
 * There is no view/edit mode. A connected form provider shows the same editable fields as an
 * unconnected one — the stored secret simply reads as saved — and the submit button wakes up only
 * once something actually changed. That keeps these rows behaving like every other row on the page.
 */
export function ProviderConnectionForm({
  provider,
  settings,
  busy,
  onConnect,
  onRemove,
  onSettingChange,
}: {
  provider: ProviderConnection;
  settings: ProviderSettingsValues;
  busy: boolean;
  onConnect: (values: Record<string, string>) => void;
  onRemove: () => void;
  onSettingChange: (key: string, value: ProviderFieldValue) => void;
}) {
  const fields = provider.auth.kind === 'form' ? provider.auth.fields : [];
  const connected = provider.status === 'connected';
  const connecting = provider.status === 'connecting';
  const stored = useMemo(
    () => storedValues(fields, provider.connectionSummary),
    [fields, provider.connectionSummary],
  );
  const [draft, setDraft] = useState<Record<string, string>>(stored);

  // Resync the draft when the connection behind it changes, so a successful connect drops the
  // plaintext secret the draft still holds; otherwise the card would offer to reconnect with
  // nothing changed. Two markers, and only these two:
  //
  //  - the stored values, by value rather than object identity, because every published state is a
  //    fresh object and resyncing on identity would wipe what the user is typing;
  //  - becoming connected, because a provider whose credential fields are all secret publishes no
  //    value at all on a successful connect, leaving the first marker unmoved.
  //
  // Status is deliberately flattened to connected-or-not: a failed connect lands on `invalid` and
  // must keep the user's input, which is the whole point of showing them the error next to it.
  const resyncKey = `${connected}|${JSON.stringify(stored)}`;
  useEffect(() => {
    // `stored` is the value `resyncKey` is derived from, so the key alone decides when to resync.
    setDraft(stored);
  }, [resyncKey]);

  const dirty = fields.some((field) => draft[field.key] !== stored[field.key]);
  const complete = fields.every((field) => {
    // A saved secret counts as present: leaving it untouched keeps the stored one.
    if (field.kind === 'text' && field.secret === true && connected) {
      return true;
    }
    return (draft[field.key] ?? '').trim().length > 0;
  });
  const submittable = complete && (!connected || dirty);
  const submitLabel = connecting
    ? 'Connecting…'
    : connected || provider.status === 'invalid'
      ? 'Reconnect'
      : 'Connect';

  return (
    <>
      <p className="m-0 px-4 pt-3 pb-1 text-sm leading-relaxed text-text-secondary">
        {provider.description}
      </p>

      {provider.error && (
        <SettingsRow label="Connection error" description={provider.error} tone="danger" />
      )}

      {fields.map((field) => (
        <ProviderFieldControl
          key={field.key}
          field={savedSecretHint(field, connected)}
          value={draft[field.key] ?? ''}
          mode="form"
          disabled={busy || connecting}
          onChange={(value) => setDraft((current) => ({ ...current, [field.key]: String(value) }))}
        />
      ))}

      <div className="flex justify-end gap-2 px-4 py-3">
        <Button
          variant="primary"
          disabled={busy || connecting || (provider.auth.kind === 'form' && !submittable)}
          onClick={() => onConnect(draft)}
        >
          {submitLabel}
        </Button>
        {(connected || provider.status === 'invalid') && (
          <Button variant="danger" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      {provider.settingsFields.provider.map((field) => (
        <ProviderFieldControl
          key={field.key}
          field={field}
          value={settings[field.key] ?? ''}
          disabled={busy}
          onChange={(value) => onSettingChange(field.key, value)}
        />
      ))}
    </>
  );
}

function storedValues(fields: readonly ProviderFieldSpec[], summary: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === 'toggle') {
      continue;
    }
    // A stored secret is never published back, so its box always starts empty.
    values[field.key] =
      field.kind === 'text' && field.secret === true ? '' : (summary[field.key] ?? field.default);
  }
  return values;
}

function savedSecretHint(field: ProviderFieldSpec, connected: boolean): ProviderFieldSpec {
  if (!connected || field.kind !== 'text' || field.secret !== true) {
    return field;
  }
  return { ...field, placeholder: 'Saved — type to replace' };
}
