import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import type { AppState, DesktopApi } from '@toph/desktop-contracts';

import { HomeApp } from './home-app';

const baseState: AppState = {
  phase: 'idle',
  shortcut: {
    chord: { modifiers: ['control', 'alt'], key: 'Space' },
    accelerator: 'Control+Alt+Space',
    label: 'Ctrl+Alt+Space',
    registered: true,
    backend: 'electron-global-shortcut',
    detail: 'Electron global shortcut registration is active.',
    installable: true,
    installed: true,
  },
  ruleSwitcherShortcut: {
    chord: { modifiers: ['control'], key: 'Space' },
    accelerator: 'Control+Space',
    label: 'Ctrl+Space',
    registered: true,
    backend: 'electron-global-shortcut',
    detail: 'Electron global shortcut registration is active.',
    installable: true,
    installed: true,
  },
  ruleSwitcher: {
    mode: 'idle',
    selectedRulePresetId: null,
    message: null,
  },
  environment: {
    platform: 'linux',
    sessionType: 'wayland',
    currentDesktop: 'GNOME',
  },
  providers: {
    ready: true,
    selectedProviderId: 'openai-sub',
    providers: [
      {
        id: 'openai-sub',
        label: 'OpenAI (ChatGPT Plus/Pro subscription)',
        description: 'Use your ChatGPT subscription to transcribe recordings.',
        billingMode: 'subscription',
        status: 'connected',
        accountId: 'account-id',
        expires: Date.now() + 3_600_000,
        error: null,
      },
    ],
  },
  vad: {
    kind: 'ready',
    activeAnalyzer: 'silero',
    detail: 'Voice activity detection is ready.',
  },
  settings: {
    version: 1,
    shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
    ruleSwitcherShortcut: { chord: { modifiers: ['control'], key: 'Space' } },
    auth: { providerId: 'openai-sub' },
    transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
    inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
    polish: { enabled: true, rulePresetId: 'general' },
    context: { screenshots: { enabled: false }, dictationPrompt: { enabled: false } },
    dashboard: { typingWpm: 50 },
    diagnostics: { enabled: false },
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
      {
        id: 'engineer',
        title: 'Engineer',
        description: 'Technical rules',
        body: 'Engineer rules',
        bodyHash: 'hash',
        sortOrder: 1,
      },
      {
        id: 'email-writing',
        title: 'Email & Writing',
        description: 'Email rules',
        body: 'Email rules',
        bodyHash: 'hash',
        sortOrder: 2,
      },
    ],
    dictionary: [],
  },
  context: {
    screenshots: {
      enabled: false,
      status: 'disabled',
      detail: 'Screenshot context is off.',
      action: 'none',
      capturedCount: 0,
    },
    dictationPrompt: {
      enabled: false,
      status: 'disabled',
      detail: 'Dictation Prompt is off.',
      capturedDurationMs: 0,
    },
  },
  permissions: {
    ready: true,
    requirements: [],
  },
  pasteSupport: {
    helper: 'ydotool',
    detail: 'Clipboard-first mode is active. Auto-paste will be attempted with ydotool.',
  },
  lastPasteAttempt: {
    helper: 'ydotool',
    status: 'idle',
    detail: 'No transcript has been pasted yet.',
  },
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
};

function createClient(state: AppState, overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    subscribeState: (listener) => {
      listener(state);
      return () => {};
    },
    toggleCapture: async () => {},
    cancelCapture: async () => {},
    resizeOverlay: async () => {},
    showSettings: async () => {},
    hideSettings: async () => {},
    installShortcut: async () => {},
    installRuleSwitcherShortcut: async () => {},
    suspendShortcut: async () => {},
    resumeShortcut: async () => {},
    openRuleSwitcher: async () => {},
    closeRuleSwitcher: async () => {},
    selectRuleSwitcherPreset: async () => {},
    connectProvider: async () => {},
    submitProviderAuthorization: async () => {},
    removeProvider: async () => {},
    refreshProviders: async () => {},
    setAuthProvider: async () => {},
    setTranscriptionProvider: async () => {},
    setTranscriptionModel: async () => {},
    setInferenceProvider: async () => {},
    setInferenceModel: async () => {},
    setPolishEnabled: async () => {},
    setTypingWpm: async () => {},
    setDiagnosticsEnabled: async () => {},
    setScreenshotContextEnabled: async () => {},
    setDictationPromptEnabled: async () => {},
    setActivePolishRulePreset: async () => {},
    createPolishRulePreset: async () => {},
    updatePolishRulePreset: async () => {},
    deletePolishRulePreset: async () => {},
    duplicatePolishRulePreset: async () => {},
    reorderPolishRulePresets: async () => {},
    createDictionaryEntry: async () => {},
    updateDictionaryEntry: async () => {},
    deleteDictionaryEntry: async () => {},
    performPermissionAction: async () => {},
    refreshPermissions: async () => {},
    rerunSession: async () => {},
    deleteSession: async () => {},
    onSoundEvent: () => () => {},
    quit: async () => {},
    ...overrides,
  };
}

describe('HomeApp', () => {
  it('renders the home screen with empty state', async () => {
    render(<HomeApp client={createClient(baseState)} />);

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('All systems go')).toBeTruthy();
    expect(screen.getByText('Your last 28 days. Tiny wins, conveniently quantified.')).toBeTruthy();
    expect(screen.getByText('28 days')).toBeTruthy();
    expect(screen.getByText('time saved')).toBeTruthy();
  });

  it('renders and updates the screenshot context setting', async () => {
    const setScreenshotContextEnabled = vi.fn<DesktopApi['setScreenshotContextEnabled']>(
      async () => {},
    );

    render(
      <HomeApp
        client={createClient(baseState, {
          setScreenshotContextEnabled,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    await screen.findByText('Screenshot Context');
    expect(screen.getAllByText('Screenshot context is off.').length).toBeGreaterThan(0);
    expect(screen.getByText('Capture screenshot context')).toBeTruthy();
    expect(
      screen.getByText(
        'Enable Screenshot Context to register this shortcut. It only captures while listening.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('switch', { name: 'Screenshot Context' }));

    await waitFor(() => expect(setScreenshotContextEnabled).toHaveBeenCalledWith(true));
  });

  it('renders and updates the Dictation Prompt setting', async () => {
    const setDictationPromptEnabled = vi.fn<DesktopApi['setDictationPromptEnabled']>(
      async () => {},
    );

    render(
      <HomeApp
        client={createClient(baseState, {
          setDictationPromptEnabled,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    await screen.findByText('Dictation Prompt');
    expect(screen.getByText('Toggle Dictation Prompt')).toBeTruthy();
    expect(
      screen.getByText(
        'Enable Dictation Prompt to register this shortcut. It only works while listening.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Dictation Prompt' }));

    await waitFor(() => expect(setDictationPromptEnabled).toHaveBeenCalledWith(true));
  });

  it('renders screenshot context permission request action', async () => {
    const performPermissionAction = vi.fn<DesktopApi['performPermissionAction']>(async () => {});
    const state = {
      ...baseState,
      settings: {
        ...baseState.settings,
        context: { screenshots: { enabled: true }, dictationPrompt: { enabled: false } },
      },
      context: {
        screenshots: {
          enabled: true,
          status: 'permission-needed' as const,
          detail:
            'Screen Recording access is needed before screenshots can be captured. Request it here.',
          action: 'request' as const,
          capturedCount: 0,
        },
        dictationPrompt: baseState.context.dictationPrompt,
      },
    };

    render(<HomeApp client={createClient(state, { performPermissionAction })} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request Access' }));

    expect(performPermissionAction).toHaveBeenCalledWith('screen');
  });

  it('renders and updates the diagnostics setting', async () => {
    const setDiagnosticsEnabled = vi.fn<DesktopApi['setDiagnosticsEnabled']>(async () => {});

    render(
      <HomeApp
        client={createClient(baseState, {
          setDiagnosticsEnabled,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    await screen.findByText('Diagnostics');
    expect(screen.queryByText('Provider status')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Diagnostics' }));

    await waitFor(() => expect(setDiagnosticsEnabled).toHaveBeenCalledWith(true));
  });

  it('rounds positive usage cost up to the nearest cent', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          dashboardStats: {
            ...baseState.dashboardStats,
            meteredSpendUsdMicros: 1,
          },
        })}
      />,
    );

    await screen.findByText('$0.01');
  });

  it('shows zero usage cost for subscription-only usage', async () => {
    render(<HomeApp client={createClient(baseState)} />);

    await screen.findByText('$0.00');
    expect(screen.getByText('usage cost')).toBeTruthy();
  });

  it('shows degraded voice detection status when Silero falls back to energy', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          vad: {
            kind: 'degraded',
            activeAnalyzer: 'energy',
            detail: 'Silero VAD failed to load. Falling back to basic energy detection.',
          },
        })}
      />,
    );

    await screen.findByText('Voice detection degraded');
  });

  it('renders the home shortcut from the configured chord as spaced keys', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          environment: {
            ...baseState.environment,
            platform: 'darwin',
          },
          shortcut: {
            ...baseState.shortcut,
            chord: { modifiers: ['command', 'shift'], key: 'K' },
            label: 'Ctrl+Alt+Space',
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getAllByLabelText('Command + Shift + K')).toHaveLength(2);
    expect(screen.getByLabelText('Control + Space')).toBeTruthy();
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByText('Ctrl+Alt+Space')).toBeNull();
  });

  it('shows the screenshot shortcut on the home screen when screenshot context is enabled', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          settings: {
            ...baseState.settings,
            context: { screenshots: { enabled: true }, dictationPrompt: { enabled: false } },
          },
          context: {
            screenshots: {
              ...baseState.context.screenshots,
              enabled: true,
              status: 'ready',
              detail: 'Screenshot context is ready.',
            },
            dictationPrompt: baseState.context.dictationPrompt,
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getByText('screenshot')).toBeTruthy();
    expect(screen.getByLabelText('Alt + S')).toBeTruthy();
  });

  it('shows the Dictation Prompt shortcut on the home screen when enabled', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          settings: {
            ...baseState.settings,
            context: { screenshots: { enabled: false }, dictationPrompt: { enabled: true } },
          },
          context: {
            screenshots: baseState.context.screenshots,
            dictationPrompt: {
              enabled: true,
              status: 'ready',
              detail: 'Ready.',
              capturedDurationMs: 0,
            },
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getByText('prompt')).toBeTruthy();
    expect(screen.getByLabelText('Alt + A')).toBeTruthy();
  });

  it('renders recent sessions when present', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const stateWithSessions: AppState = {
      ...baseState,
      settings: {
        ...baseState.settings,
        diagnostics: { enabled: true },
      },
      recentSessions: [
        {
          id: 'session-1',
          status: 'completed',
          createdAt: Date.now() - 120_000,
          errorMessage: null,
          errorReport: null,
          canRetry: true,
          selectedOutput: {
            id: 'conv-1',
            text: 'This is a test dictation result from the mock flow.',
            kind: 'polished',
            rulePresetId: 'engineer',
            rulePresetHash: 'hash',
            createdAt: Date.now() - 120_000,
          },
          pasteStatus: 'success',
          pasteDetail: 'Pasted via ydotool.',
          dictationPromptText: 'Use the visible message and keep the answer concise.',
          screenshots: [
            {
              path: '/tmp/toph/session/screenshots/context-01.jpg',
              mimeType: 'image/jpeg',
              detail: 'high',
              capturedAt: Date.now() - 119_000,
              width: 1280,
              height: 720,
              byteSize: 82_944,
              duplicateReferences: [
                {
                  capturedAt: Date.now() - 114_000,
                  referencePath: '/tmp/toph/session/screenshots/context-01.jpg',
                  meanAbsoluteDifference: 0.004,
                  changedPixelRatio: 0.01,
                },
              ],
            },
          ],
          diagnostics: {
            sessionId: 'session-1',
            outputId: 'conv-1',
            outputKind: 'polished',
            sessionStartedAt: Date.now() - 130_000,
            sessionEndedAt: Date.now() - 120_000,
            sessionDurationMs: 10_000,
            dictationPromptTextPath: '/tmp/toph/session/dictation-prompt.txt',
            dictationPromptCharacterCount: 48,
            screenshotCount: 1,
            screenshotDirectory: '/tmp/toph/session/screenshots',
          },
        },
        {
          id: 'session-2',
          status: 'failed',
          createdAt: Date.now() - 600_000,
          errorMessage: '1 transcription batch failed or did not finish.',
          errorReport:
            'Toph error report\n\nSession: session-2\n\nSession error:\n1 transcription batch failed or did not finish.\n\nBatch errors:\n1. batch-1\n   Sequence: 0\n   Attempts: 3\n   Error: OpenAI-sub transcription failed: HTTP 500 provider exploded.',
          canRetry: true,
          selectedOutput: null,
          pasteStatus: 'idle',
          pasteDetail: 'Loaded from local history.',
        },
      ],
    };

    render(<HomeApp client={createClient(stateWithSessions)} />);

    await screen.findByText('This is a test dictation result from the mock flow.');
    expect(screen.queryByText('Pasted')).toBeNull();
    expect(screen.queryByText('Rules: general')).toBeNull();
    expect(screen.queryByText('Paste failed')).toBeNull();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('1 transcription batch failed or did not finish.')).toBeTruthy();
    expect(screen.getByLabelText('Copy debug report')).toBeTruthy();
    expect(screen.queryByText('Pasted via ydotool.')).toBeNull();
    expect(screen.queryByText('ydotool timed out.')).toBeNull();
    expect(screen.getAllByAltText('Screenshot context 1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('This is a test dictation result from the mock flow.'));

    expect(screen.getByText(/Polished with the/)).toBeTruthy();
    expect(screen.getByText('Engineer')).toBeTruthy();
    expect(screen.queryByText(/hash/)).toBeNull();
    expect(screen.getByText('Screenshot diagnostics')).toBeTruthy();
    expect(screen.getByText('Dictation Prompt transcript')).toBeTruthy();
    expect(
      screen.getAllByText('Use the visible message and keep the answer concise.'),
    ).toHaveLength(2);
    expect(screen.getAllByText('prompt chars').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/tmp/toph/session/dictation-prompt.txt').length).toBeGreaterThan(0);
    expect(screen.getByText('context-01')).toBeTruthy();
    expect(screen.getByText('similar skips')).toBeTruthy();
    expect(screen.getByText('similar sample 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview screenshot context 1' }));

    expect(screen.getByRole('dialog', { name: 'Screenshot context 1' })).toBeTruthy();
    expect(screen.getByAltText('Screenshot context 1 enlarged')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Screenshot context 1' })).toBeNull();
    });

    fireEvent.click(screen.getByLabelText('Copy debug report'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error: OpenAI-sub transcription failed: HTTP 500 provider exploded.',
        ),
      );
    });
  });

  it('renders onboarding when required permissions are missing', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          environment: {
            ...baseState.environment,
            platform: 'darwin',
          },
          permissions: {
            ready: false,
            requirements: [
              {
                id: 'microphone',
                label: 'Microphone',
                status: 'promptable',
                required: true,
                detail: 'Toph needs microphone access before it can listen.',
                action: 'request',
              },
              {
                id: 'accessibility',
                label: 'Accessibility',
                status: 'missing',
                required: true,
                detail: 'Toph needs Accessibility access to paste for you.',
                action: 'open-settings',
              },
            ],
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });
    expect(screen.getByText(/Real-time voice transcription across all your apps/)).toBeTruthy();
    expect(screen.getByText(/Bring your own subscription/)).toBeTruthy();
    expect(screen.getByText('Microphone')).toBeTruthy();
    expect(screen.getByText('Accessibility')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('keeps onboarding open after preset selection until the user continues', async () => {
    let publish: ((state: AppState) => void) | null = null;
    const initialState = {
      ...baseState,
      settings: {
        ...baseState.settings,
        polish: { enabled: true, rulePresetId: null },
      },
    };
    const selectedState = {
      ...baseState,
      settings: {
        ...baseState.settings,
        polish: { enabled: true, rulePresetId: 'engineer' },
      },
    };
    const setActivePolishRulePreset = vi.fn<DesktopApi['setActivePolishRulePreset']>(
      async (rulePresetId) => {
        act(() => {
          publish?.({
            ...selectedState,
            settings: {
              ...selectedState.settings,
              polish: { enabled: true, rulePresetId },
            },
          });
        });
      },
    );

    render(
      <HomeApp
        client={{
          ...createClient(initialState),
          subscribeState: (listener) => {
            publish = listener;
            listener(initialState);
            return () => {};
          },
          setActivePolishRulePreset,
        }}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Engineer/ }));

    await waitFor(() => expect(setActivePolishRulePreset).toHaveBeenCalledWith('engineer'));
    expect(screen.getByRole('heading', { name: /Your fingers called/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(
      screen
        .getByText('Setup complete. The tiny dictation empire is operational.')
        .closest('.animate-onboarding-ready-enter'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByText('Nothing here yet.');
  });

  it('skips final onboarding when startup readiness becomes complete without a setup action', async () => {
    let publish: ((state: AppState) => void) | null = null;
    const initialState = {
      ...baseState,
      settings: {
        ...baseState.settings,
        polish: { enabled: true, rulePresetId: null },
      },
    };

    render(
      <HomeApp
        client={{
          ...createClient(initialState),
          subscribeState: (listener) => {
            publish = listener;
            listener(initialState);
            return () => {};
          },
        }}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });

    act(() => {
      publish?.(baseState);
    });

    await screen.findByText('Nothing here yet.');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('keeps onboarding open after a manual refresh completes setup', async () => {
    let publish: ((state: AppState) => void) | null = null;
    const initialState = {
      ...baseState,
      permissions: {
        ready: false,
        requirements: [
          {
            id: 'microphone' as const,
            label: 'Microphone',
            status: 'promptable' as const,
            required: true,
            detail: 'Toph needs microphone access before it can listen.',
            action: 'request' as const,
          },
        ],
      },
    };
    const refreshPermissions = vi.fn<DesktopApi['refreshPermissions']>(async () => {
      act(() => {
        publish?.(baseState);
      });
    });

    render(
      <HomeApp
        client={{
          ...createClient(initialState, { refreshPermissions }),
          subscribeState: (listener) => {
            publish = listener;
            listener(initialState);
            return () => {};
          },
        }}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => expect(refreshPermissions).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: /Your fingers called/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('keeps the onboarding completion bar hidden while preset selection is pending', async () => {
    const setActivePolishRulePreset = vi.fn<DesktopApi['setActivePolishRulePreset']>(
      () => new Promise(() => {}),
    );

    render(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            settings: {
              ...baseState.settings,
              polish: { enabled: true, rulePresetId: null },
            },
          },
          { setActivePolishRulePreset },
        )}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });
    fireEvent.click(screen.getByRole('button', { name: /Engineer/ }));

    await waitFor(() => expect(setActivePolishRulePreset).toHaveBeenCalledWith('engineer'));
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('refreshes onboarding state when the window regains focus', async () => {
    const refreshPermissions = vi.fn<() => Promise<void>>(async () => {});
    const refreshProviders = vi.fn<() => Promise<void>>(async () => {});

    render(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            permissions: {
              ready: false,
              requirements: [
                {
                  id: 'microphone',
                  label: 'Microphone',
                  status: 'promptable',
                  required: true,
                  detail: 'Toph needs microphone access before it can listen.',
                  action: 'request',
                },
              ],
            },
          },
          { refreshPermissions, refreshProviders },
        )}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(refreshPermissions).toHaveBeenCalledTimes(1);
      expect(refreshProviders).toHaveBeenCalledTimes(1);
    });
  });

  it('shows complete permissions when no requirements are needed', async () => {
    render(
      <HomeApp
        client={createClient({
          ...baseState,
          providers: {
            ...baseState.providers,
            ready: false,
            providers: [
              {
                ...baseState.providers.providers[0],
                status: 'missing',
              },
            ],
          },
          permissions: {
            ready: true,
            requirements: [],
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });
    expect(screen.getByText('No permissions needed')).toBeTruthy();
  });

  it('still refreshes providers when permission refresh fails', async () => {
    const refreshPermissions = vi.fn<() => Promise<void>>(async () => {
      throw new Error('permission refresh failed');
    });
    const refreshProviders = vi.fn<() => Promise<void>>(async () => {});

    render(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            permissions: {
              ready: false,
              requirements: [
                {
                  id: 'microphone',
                  label: 'Microphone',
                  status: 'promptable',
                  required: true,
                  detail: 'Toph needs microphone access before it can listen.',
                  action: 'request',
                },
              ],
            },
          },
          { refreshPermissions, refreshProviders },
        )}
      />,
    );

    await screen.findByRole('heading', { name: /Your fingers called/ });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(refreshPermissions).toHaveBeenCalledTimes(1);
      expect(refreshProviders).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/Refresh could not verify everything/);
    await screen.findByRole('button', { name: 'Check again' });
  });
});
