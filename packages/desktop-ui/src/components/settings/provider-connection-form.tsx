import type {
  ProviderConnection,
  ProviderFieldValue,
  ProviderSettingsValues,
} from '@toph/desktop-contracts';

import { useProviderConnectionDraft } from '../../hooks/use-provider-connection-draft';
import { Button } from '../button';
import { ProviderFieldControl } from '../provider/provider-field-controls';
import { SettingsRow } from './settings-controls';

/**
 * The expanded body of a provider card: description, error, the declared credential fields, the
 * submit and remove actions, and the provider-group settings. An OAuth provider declares no
 * credential fields, so the same code renders it as the submit button alone — this switches on
 * `auth.kind` only, never on the provider id.
 *
 * What a field starts as, when the draft resyncs and when submitting is offered belong to
 * `useProviderConnectionDraft`, which onboarding's form shares. Everything here is this surface's
 * own chrome.
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
  const draft = useProviderConnectionDraft(provider);
  const connected = provider.status === 'connected';
  const connecting = provider.status === 'connecting';
  // Settings speaks about the connection; onboarding speaks about the browser it is about to open.
  // The two vocabularies are deliberate, so neither is derived from the other.
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

      {draft.fields.map((field) => (
        <ProviderFieldControl
          key={field.key}
          field={field}
          value={draft.values[field.key] ?? ''}
          mode="form"
          disabled={busy || connecting}
          onChange={(value) => draft.setValue(field.key, String(value))}
        />
      ))}

      <div className="flex justify-end gap-2 px-4 py-3">
        <Button
          variant="primary"
          disabled={busy || connecting || !draft.submittable}
          onClick={() => onConnect(draft.values)}
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
