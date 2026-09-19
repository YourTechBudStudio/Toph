import type { ProviderConnection } from '@toph/desktop-contracts';

import { useProviderConnectionDraft } from '../../hooks/use-provider-connection-draft';
import { Button } from '../button';
import { ProviderFieldControl } from '../settings/provider-field-controls';

/**
 * The connection body for one provider during onboarding: its declared credential fields, the
 * submit action, the manual-code fallback and the error. Switches on `auth.kind` only, never on the
 * provider id.
 *
 * The draft's rules — what a field starts as, when it resyncs, when submitting is offered — come
 * from `useProviderConnectionDraft`, shared with the Settings form so the two cannot drift.
 */
export function ProviderConnect({
  provider,
  busy,
  manualInput,
  onManualInputChange,
  onConnect,
  onSubmitManual,
}: {
  provider: ProviderConnection;
  busy: boolean;
  manualInput: string;
  onManualInputChange: (value: string) => void;
  onConnect: (values: Record<string, string>) => void;
  onSubmitManual: () => void;
}) {
  const draft = useProviderConnectionDraft(provider);
  const connected = provider.status === 'connected';
  const connecting = provider.status === 'connecting';

  return (
    <div className="grid gap-3">
      {provider.error && (
        <p className="m-0 rounded-2xl border border-accent-red/16 bg-accent-red/10 px-3.5 py-2.5 text-sm text-accent-red">
          {provider.error}
        </p>
      )}

      {draft.fields.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/4">
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
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant={connected ? 'secondary' : 'primary'}
          disabled={busy || connecting || !draft.submittable}
          onClick={() => onConnect(draft.values)}
        >
          {submitLabel(provider)}
        </Button>
        {connected && (
          <span className="truncate text-sm text-text-tertiary">
            {connectionIdentity(provider)}
          </span>
        )}
      </div>

      {provider.auth.kind === 'oauth' && connecting && (
        <div className="grid gap-2 rounded-2xl border border-white/8 bg-white/4 p-3">
          <p className="m-0 text-sm text-text-secondary">
            Waiting for browser authorization. If localhost gets grumpy, paste the redirect URL or
            code here.
          </p>
          <div className="flex gap-2 max-[640px]:flex-col">
            <input
              className="min-w-0 flex-1 rounded-full border border-white/8 bg-canvas px-3 py-2 text-sm text-text-primary outline-none transition-colors duration-150 placeholder:text-text-tertiary focus:border-accent-blue/40"
              value={manualInput}
              placeholder="Authorization URL or code"
              onChange={(event) => onManualInputChange(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={manualInput.trim().length === 0}
              onClick={onSubmitManual}
            >
              Submit code
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Onboarding talks about the browser it is about to open; Settings talks about the connection.
 * The two vocabularies are deliberate, so neither surface derives its labels from the other.
 */
function submitLabel(provider: ProviderConnection) {
  if (provider.status === 'connecting') {
    return provider.auth.kind === 'oauth' ? 'Opening browser…' : 'Connecting…';
  }
  if (provider.status === 'connected' || provider.status === 'invalid') {
    return 'Reconnect';
  }
  return provider.auth.kind === 'oauth' ? 'Connect provider' : 'Connect';
}

/**
 * What to show beside a connected provider: the account it signed in as, or failing that whichever
 * credential it publishes back — the first non-secret field it declared, so a provider that calls
 * its endpoint `host` reads as well as one that calls it `baseUrl`.
 */
function connectionIdentity(provider: ProviderConnection) {
  if (provider.accountId) {
    return provider.accountId;
  }
  if (provider.auth.kind === 'form') {
    for (const field of provider.auth.fields) {
      // `connectionSummary` is contractually non-secret, but this renders a credential if that
      // ever slips, so the filter is applied here rather than assumed.
      if (field.kind === 'text' && field.secret === true) {
        continue;
      }
      const value = provider.connectionSummary[field.key];
      if (value) {
        return value;
      }
    }
  }
  return 'Ready to dictate';
}
