import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ProviderConnection, ProviderFieldSpec } from '@toph/desktop-contracts';

import { useProviderConnectionDraft } from './use-provider-connection-draft';

const credentialFields: ProviderFieldSpec[] = [
  { kind: 'text', key: 'baseUrl', label: 'Base URL', default: '', required: true },
  { kind: 'text', key: 'apiKey', label: 'API key', default: '', secret: true, required: true },
];

function formProvider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'openai',
    label: 'OpenAI (API key)',
    description: 'Use an OpenAI API key.',
    billingMode: 'metered',
    roles: ['transcription', 'inference'],
    auth: { kind: 'form', fields: credentialFields },
    settingsFields: { provider: [], transcription: [], inference: [] },
    status: 'missing',
    accountId: null,
    expires: null,
    error: null,
    connectionSummary: {},
    ...overrides,
  };
}

/** A second form provider declaring the same field keys: the case the resync must tell apart. */
function otherFormProvider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return formProvider({ id: 'openai-sub', label: 'Other endpoint', ...overrides });
}

/** A minimal surface, so the hook is exercised the way a real form uses it. */
function DraftHarness({ provider }: { provider: ProviderConnection }) {
  const draft = useProviderConnectionDraft(provider);

  return (
    <div>
      {draft.fields.map((field) => (
        <input
          key={field.key}
          aria-label={field.label}
          placeholder={field.kind === 'text' ? field.placeholder : undefined}
          value={draft.values[field.key] ?? ''}
          onChange={(event) => draft.setValue(field.key, event.currentTarget.value)}
        />
      ))}
      <button type="button" disabled={!draft.submittable}>
        Submit
      </button>
    </div>
  );
}

function submitButton() {
  return screen.getByRole('button', { name: 'Submit' });
}

function fill(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe('useProviderConnectionDraft', () => {
  it('offers submission only once every field is filled', () => {
    render(<DraftHarness provider={formProvider()} />);

    expect(submitButton().hasAttribute('disabled')).toBe(true);
    fill({ 'Base URL': 'https://api.test/v1' });
    expect(submitButton().hasAttribute('disabled')).toBe(true);
    fill({ 'API key': 'sk-secret' });
    expect(submitButton().hasAttribute('disabled')).toBe(false);
  });

  it('drops a typed secret once the connection it created is published', () => {
    const view = render(<DraftHarness provider={formProvider()} />);
    fill({ 'Base URL': 'https://api.test/v1', 'API key': 'sk-secret' });

    // What main publishes once the connect succeeds: a summary, and never the secret.
    view.rerender(
      <DraftHarness
        provider={formProvider({
          status: 'connected',
          connectionSummary: { baseUrl: 'https://api.test/v1' },
        })}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('');
    expect(screen.getByLabelText('API key').getAttribute('placeholder')).toBe(
      'Saved — type to replace',
    );
    expect(submitButton().hasAttribute('disabled')).toBe(true);
  });

  it('drops a typed secret even when the connection publishes no value of its own', () => {
    // Nothing but secret fields: `connectionSummary` is empty before and after the connect, so
    // becoming connected is the only signal the draft has.
    const secretOnly = (overrides: Partial<ProviderConnection> = {}) =>
      formProvider({
        auth: { kind: 'form', fields: [credentialFields[1]] },
        ...overrides,
      });
    const view = render(<DraftHarness provider={secretOnly()} />);
    fill({ 'API key': 'sk-secret' });

    view.rerender(<DraftHarness provider={secretOnly({ status: 'connected' })} />);

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('');
    expect(submitButton().hasAttribute('disabled')).toBe(true);
  });

  it('keeps an in-progress edit when an unrelated republish arrives', () => {
    const connected = () =>
      formProvider({ status: 'connected', connectionSummary: { baseUrl: 'https://api.test/v1' } });
    const view = render(<DraftHarness provider={connected()} />);
    fill({ 'API key': 'sk-new' });

    view.rerender(<DraftHarness provider={connected()} />);

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('sk-new');
    expect(submitButton().hasAttribute('disabled')).toBe(false);
  });

  it('starts a fresh draft when the same form is pointed at another provider', () => {
    // Both providers declare the same field keys, so their stored values serialise identically:
    // only the provider id distinguishes them, and a credential typed for one must never be
    // submittable under the other.
    const view = render(<DraftHarness provider={formProvider()} />);
    fill({ 'Base URL': 'https://api.test/v1', 'API key': 'sk-secret' });

    view.rerender(<DraftHarness provider={otherFormProvider()} />);

    expect(screen.getByLabelText<HTMLInputElement>('Base URL').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('');
    expect(submitButton().hasAttribute('disabled')).toBe(true);
  });

  it('keeps an OAuth provider submittable, since it declares no fields to complete', () => {
    render(
      <DraftHarness provider={formProvider({ auth: { kind: 'oauth' }, status: 'connected' })} />,
    );

    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(submitButton().hasAttribute('disabled')).toBe(false);
  });
});
