import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppState,
  type DesktopApi,
  type ProviderConnection,
} from '@toph/desktop-contracts';

import { createStaticDesktopApiStub } from '../test-support/desktop-api-stub';
import { SettingsPage } from './settings-page';

/**
 * These cases cover the wiring, not the presentation: the sections themselves are pinned by
 * `components/settings/provider-sections.test.tsx` and `hooks/use-provider-connection-draft.test.tsx`.
 * The risk this page carries is mis-binding — calling the wrong API method, or the right one with
 * the wrong provider id, group or key — which only shows up with two providers and mixed routing.
 */

const chatgpt: ProviderConnection = {
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
  accountId: 'user@example.com',
  expires: null,
  error: null,
  connectionSummary: {},
};

const openai: ProviderConnection = {
  id: 'openai',
  label: 'OpenAI (API key)',
  description: 'Use an OpenAI API key.',
  billingMode: 'metered',
  roles: ['transcription', 'inference'],
  auth: {
    kind: 'form',
    fields: [
      { kind: 'text', key: 'baseUrl', label: 'Base URL', default: '', required: true },
      { kind: 'text', key: 'apiKey', label: 'API key', default: '', secret: true, required: true },
    ],
  },
  settingsFields: {
    provider: [],
    transcription: [{ kind: 'text', key: 'model', label: 'Transcription model', default: 'api' }],
    inference: [{ kind: 'text', key: 'model', label: 'Polishing model', default: 'api-polish' }],
  },
  status: 'connected',
  accountId: null,
  expires: null,
  error: null,
  connectionSummary: { baseUrl: 'https://api.test/v1' },
};

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

/** Transcription on ChatGPT, polishing on OpenAI: the mixed routing this feature exists for. */
function mixedRoutingState(overrides: Partial<AppState> = {}): AppState {
  return {
    app: { version: '0.0.2', update: { kind: 'idle', lastCheckedAt: null } },
    phase: 'idle',
    activeFailure: null,
    activeInputDeviceFallback: null,
    shortcut: {
      chord: { modifiers: ['control', 'alt'], key: 'Space' },
      accelerator: 'Control+Alt+Space',
      label: 'Ctrl+Alt+Space',
      registered: true,
      backend: 'electron-global-shortcut',
      detail: 'Registered.',
      installable: true,
      installed: true,
    },
    ruleSwitcherShortcut: {
      chord: { modifiers: ['control'], key: 'Space' },
      accelerator: 'Control+Space',
      label: 'Ctrl+Space',
      registered: true,
      backend: 'electron-global-shortcut',
      detail: 'Registered.',
      installable: true,
      installed: true,
    },
    ruleSwitcher: { mode: 'idle', selectedRulePresetId: null, message: null },
    environment: { platform: 'linux', sessionType: 'wayland', currentDesktop: 'GNOME' },
    providers: { ready: true, providers: [chatgpt, openai] },
    vad: { kind: 'ready', activeAnalyzer: 'silero', detail: 'Ready.' },
    settings: {
      ...DEFAULT_APP_SETTINGS,
      transcription: { providerId: 'openai-sub' },
      inference: { providerId: 'openai' },
      providers: providerSettings,
      polish: { enabled: true, rulePresetId: 'general', dictionaryDefaultsSeeded: false },
    },
    polish: {
      rulePresets: [
        {
          id: 'general',
          title: 'General',
          description: 'Clean rules',
          body: 'General rules',
          bodyHash: 'hash',
          sortOrder: 0,
        },
      ],
      dictionary: [],
    },
    permissions: { ready: true, requirements: [] },
    pasteSupport: { helper: 'ydotool', detail: 'Clipboard-first mode is active.' },
    lastPasteAttempt: { helper: 'ydotool', status: 'idle', detail: 'Nothing pasted yet.' },
    lastTranscript: null,
    recentSessions: [],
    dashboardStats: {
      rollingWindowDays: 28,
      words: 0,
      averageSpokenWpm: null,
      timeSavedMinutes: 0,
      meteredSpendUsdMicros: 0,
      subscriptionEstimatedCostUsdMicros: 0,
      totalEstimatedCostUsdMicros: 0,
      costEstimateIncomplete: false,
    },
    updatedAt: 1,
    ...overrides,
  };
}

function renderSettings(overrides: Partial<DesktopApi> = {}, state = mixedRoutingState()) {
  const client = createStaticDesktopApiStub(state, overrides);
  render(<SettingsPage state={state} client={client} onBack={() => {}} />);
  return client;
}

describe('SettingsPage provider wiring', () => {
  it('writes a role-group field against the provider routed for that role', async () => {
    const setProviderSetting = vi.fn<DesktopApi['setProviderSetting']>(async () => {});
    renderSettings({ setProviderSetting });

    // Two providers declare a `model` field per role, so a wrong binding is invisible without
    // mixed routing: polishing is on `openai` while transcription is on `openai-sub`.
    const polishingModel = screen.getByLabelText('Polishing model');
    fireEvent.change(polishingModel, { target: { value: 'gpt-5.4' } });
    fireEvent.blur(polishingModel);

    await waitFor(() =>
      expect(setProviderSetting).toHaveBeenCalledWith('openai', 'inference', 'model', 'gpt-5.4'),
    );

    const transcriptionModel = screen.getByLabelText('Transcription model');
    fireEvent.change(transcriptionModel, { target: { value: 'whisper-1' } });
    fireEvent.blur(transcriptionModel);

    await waitFor(() =>
      expect(setProviderSetting).toHaveBeenCalledWith(
        'openai-sub',
        'transcription',
        'model',
        'whisper-1',
      ),
    );
  });

  it('routes a role with the setter that belongs to it', async () => {
    const setTranscriptionProvider = vi.fn<DesktopApi['setTranscriptionProvider']>(async () => {});
    const setInferenceProvider = vi.fn<DesktopApi['setInferenceProvider']>(async () => {});
    renderSettings({ setTranscriptionProvider, setInferenceProvider });

    fireEvent.click(screen.getByRole('combobox', { name: 'Select transcription provider' }));

    const option = await screen.findByRole('option', { name: 'OpenAI (API key)' });
    // base-ui's select commits on pointer release, not on a bare click.
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);

    await waitFor(() => expect(setTranscriptionProvider).toHaveBeenCalledWith('openai'));
    expect(setInferenceProvider).not.toHaveBeenCalled();
  });

  it('connects and removes the provider whose card was used', async () => {
    const connectProvider = vi.fn<DesktopApi['connectProvider']>(async () => {});
    const removeProvider = vi.fn<DesktopApi['removeProvider']>(async () => {});
    renderSettings({ connectProvider, removeProvider });

    // The second card is the form provider; each card's own button carries its own id.
    const manageButtons = screen.getAllByRole('button', { name: 'Manage' });
    fireEvent.click(manageButtons[1]);
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    await waitFor(() =>
      expect(connectProvider).toHaveBeenCalledWith('openai', {
        baseUrl: 'https://api.test/v1',
        apiKey: 'sk-new',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeProvider).toHaveBeenCalledWith('openai'));
  });

  it('leaves the other provider usable while one connect is still pending', async () => {
    // An OAuth connect does not settle until the browser round trip finishes, and an abandoned
    // login never settles at all, so a shared busy flag would strand setup until a restart.
    // Never resolves, which is the abandoned login: the connect promise has no deadline.
    const connectProvider = vi.fn<DesktopApi['connectProvider']>(() => new Promise<void>(() => {}));
    renderSettings({ connectProvider });

    const manageButtons = screen.getAllByRole('button', { name: 'Manage' });
    fireEvent.click(manageButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(connectProvider).toHaveBeenCalledWith('openai-sub', {}));

    // The peer card opens, accepts input and can still submit while the first connect hangs.
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage' })[0]);
    const apiKey = screen.getByLabelText<HTMLInputElement>('API key');
    expect(apiKey.hasAttribute('disabled')).toBe(false);
    fireEvent.change(apiKey, { target: { value: 'sk-peer' } });

    const peerButtons = screen.getAllByRole('button', { name: 'Reconnect' });
    const peerSubmit = peerButtons[peerButtons.length - 1];
    expect(peerSubmit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(peerSubmit);

    await waitFor(() =>
      expect(connectProvider).toHaveBeenCalledWith('openai', {
        baseUrl: 'https://api.test/v1',
        apiKey: 'sk-peer',
      }),
    );
  });

  it('names the provider behind each role in the diagnostics export', async () => {
    renderSettings({}, mixedRoutingState());

    fireEvent.click(screen.getByText('Show diagnostics'));

    expect(
      await screen.findByText(/transcription: ChatGPT subscription, polishing: OpenAI \(API key\)/),
    ).toBeTruthy();
  });

  it('says a role is unchosen rather than naming the wrong provider', async () => {
    const state = mixedRoutingState();
    renderSettings(
      {},
      {
        ...state,
        providers: { ready: false, providers: [chatgpt, openai] },
        settings: {
          ...state.settings,
          transcription: { providerId: 'openai-sub' },
          inference: { providerId: null },
        },
      },
    );

    fireEvent.click(screen.getByText('Show diagnostics'));

    expect(
      await screen.findByText(
        /not ready \(transcription: ChatGPT subscription, polishing: not chosen\)/,
      ),
    ).toBeTruthy();
  });
});
