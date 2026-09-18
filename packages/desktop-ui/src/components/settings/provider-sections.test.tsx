import { fireEvent, render, screen } from '@testing-library/react';

import type {
  AppSettings,
  ProviderConnection,
  ProviderConnectionStatus,
  ProviderFieldSpec,
  ProviderId,
  ProviderRole,
} from '@toph/desktop-contracts';

import { ProviderSection } from './provider-section';
import { RoutingSection } from './routing-section';

const authFields: ProviderFieldSpec[] = [
  { kind: 'text', key: 'baseUrl', label: 'Base URL', default: '', required: true },
  { kind: 'text', key: 'apiKey', label: 'API key', default: '', secret: true, required: true },
];

function oauthProvider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'openai-sub',
    label: 'ChatGPT subscription',
    description: 'Use your ChatGPT subscription.',
    billingMode: 'subscription',
    roles: ['transcription', 'inference'],
    auth: { kind: 'oauth' },
    settingsFields: {
      provider: [],
      transcription: [{ kind: 'text', key: 'model', label: 'Transcription model', default: 'sub' }],
      inference: [{ kind: 'text', key: 'model', label: 'Polishing model', default: 'sub-polish' }],
    },
    status: 'connected',
    accountId: null,
    expires: null,
    error: null,
    connectionSummary: {},
    ...overrides,
  };
}

function formProvider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'openai',
    label: 'OpenAI (API key)',
    description: 'Use an OpenAI API key.',
    billingMode: 'metered',
    roles: ['transcription', 'inference'],
    auth: { kind: 'form', fields: authFields },
    settingsFields: {
      provider: [],
      transcription: [{ kind: 'text', key: 'model', label: 'Transcription model', default: 'api' }],
      inference: [{ kind: 'text', key: 'model', label: 'Polishing model', default: 'api-polish' }],
    },
    status: 'missing',
    accountId: null,
    expires: null,
    error: null,
    connectionSummary: {},
    ...overrides,
  };
}

const providerSettings = {
  'openai-sub': {
    provider: {},
    transcription: { model: 'sub' },
    inference: { model: 'sub-polish' },
  },
  openai: {
    provider: {},
    transcription: { model: 'api' },
    inference: { model: 'api-polish' },
  },
} as AppSettings['providers'];

function renderProviders(providers: ProviderConnection[]) {
  return render(
    <ProviderSection
      providers={providers}
      providerSettings={providerSettings}
      busyProviderId={null}
      onConnect={() => {}}
      onRemove={() => {}}
      onSettingChange={() => {}}
    />,
  );
}

function renderRouting(
  providers: ProviderConnection[],
  routing: Record<ProviderRole, ProviderId | null>,
) {
  return render(
    <RoutingSection
      providers={providers}
      providerSettings={providerSettings}
      routing={routing}
      disabled={false}
      onProviderChange={() => {}}
      onSettingChange={() => {}}
    />,
  );
}

function openSelect(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
}

describe('ProviderSection', () => {
  for (const status of ['missing', 'connecting', 'connected', 'invalid'] as const) {
    it(`renders a form provider that is ${status} without console errors`, () => {
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));

      renderProviders([
        oauthProvider(),
        formProvider({
          status: status as ProviderConnectionStatus,
          error: status === 'invalid' ? 'Invalid API key (HTTP 401).' : null,
          connectionSummary: status === 'connected' ? { baseUrl: 'https://api.test/v1' } : {},
        }),
      ]);

      expect(screen.getAllByText('OpenAI (API key)').length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      spy.mockRestore();
    });
  }

  it('drops a typed secret once the connection it created is published', () => {
    const view = renderProviders([formProvider()]);

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.test/v1' },
    });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } });
    expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(false);

    // What the main process publishes once the connect succeeds: a summary, and never the secret.
    view.rerender(
      <ProviderSection
        providers={[
          formProvider({
            status: 'connected',
            connectionSummary: { baseUrl: 'https://api.test/v1' },
          }),
        ]}
        providerSettings={providerSettings}
        busyProviderId={null}
        onConnect={() => {}}
        onRemove={() => {}}
        onSettingChange={() => {}}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('');
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(true);
  });

  it('drops a typed secret even when the connection publishes no value of its own', () => {
    // A form with nothing but secret fields: `connectionSummary` is empty before and after the
    // connect, so becoming connected is the only signal the draft has.
    const secretOnly = (overrides: Partial<ProviderConnection> = {}) =>
      formProvider({
        auth: {
          kind: 'form',
          fields: [
            {
              kind: 'text',
              key: 'apiKey',
              label: 'API key',
              default: '',
              secret: true,
              required: true,
            },
          ],
        },
        ...overrides,
      });
    const view = renderProviders([secretOnly()]);

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } });

    view.rerender(
      <ProviderSection
        providers={[secretOnly({ status: 'connected' })]}
        providerSettings={providerSettings}
        busyProviderId={null}
        onConnect={() => {}}
        onRemove={() => {}}
        onSettingChange={() => {}}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('');
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps an in-progress edit when an unrelated republish arrives', () => {
    const view = renderProviders([
      formProvider({ status: 'connected', connectionSummary: { baseUrl: 'https://api.test/v1' } }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-new' } });

    view.rerender(
      <ProviderSection
        providers={[
          formProvider({
            status: 'connected',
            connectionSummary: { baseUrl: 'https://api.test/v1' },
          }),
        ]}
        providerSettings={providerSettings}
        busyProviderId={null}
        onConnect={() => {}}
        onRemove={() => {}}
        onSettingChange={() => {}}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('sk-new');
  });
});

describe('RoutingSection', () => {
  it('offers a provider only for the roles it serves', () => {
    renderRouting([oauthProvider(), formProvider({ roles: ['inference'], status: 'connected' })], {
      transcription: 'openai-sub',
      inference: 'openai-sub',
    });

    openSelect('Select transcription provider');
    expect(screen.queryByRole('option', { name: 'OpenAI (API key)' })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    openSelect('Select polishing provider');
    expect(screen.getByRole('option', { name: 'OpenAI (API key)' })).toBeTruthy();
  });

  it('lists an unconnected provider without letting a role be routed to it', () => {
    renderRouting([oauthProvider(), formProvider()], {
      transcription: 'openai-sub',
      inference: 'openai-sub',
    });

    openSelect('Select polishing provider');

    const option = screen.getByRole('option', { name: 'OpenAI (API key) — not set up' });
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the currently routed provider selectable even when it is not connected', () => {
    renderRouting([oauthProvider(), formProvider()], {
      transcription: 'openai-sub',
      inference: 'openai',
    });

    openSelect('Select polishing provider');

    // base-ui omits the attribute entirely when an item is selectable.
    const option = screen.getByRole('option', { name: 'OpenAI (API key) — not set up' });
    expect(option.getAttribute('aria-disabled')).toBeNull();
  });
});
