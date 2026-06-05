import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import type { AppState, DesktopApi } from '@toph/desktop-contracts';

import { HomeApp } from './home-app';

const baseState: AppState = {
  app: {
    version: '0.0.2',
    update: { kind: 'idle', lastCheckedAt: null },
  },
  phase: 'idle',
  activeFailure: null,
  activeInputDeviceFallback: null,
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
    audio: {
      inputDevice: { id: 'default', label: null },
      outputDevice: { id: 'default', label: null },
    },
    polish: { enabled: true, rulePresetId: 'general', dictionaryDefaultsSeeded: false },
    dashboard: { typingWpm: 50 },
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
    platform: state.environment.platform,
    subscribeState: (listener) => {
      listener(state);
      return () => {};
    },
    toggleCapture: async () => {},
    cancelCapture: async () => {},
    resizeOverlay: async () => {},
    showSettings: async () => {},
    hideSettings: async () => {},
    minimizeSettings: async () => {},
    toggleSettingsMaximized: async () => {},
    getSettingsWindowBounds: async () => null,
    moveSettingsWindow: async () => {},
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
    setAudioInputDevice: async () => {},
    setAudioOutputDevice: async () => {},
    setPolishEnabled: async () => {},
    setTypingWpm: async () => {},
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
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    restartToUpdate: async () => {},
    dismissUpdateNotice: async () => {},
    openUpdateReadme: async () => {},
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

  it('renders Linux window controls that call native window actions', async () => {
    const minimizeSettings = vi.fn<() => Promise<void>>(async () => {});
    const toggleSettingsMaximized = vi.fn<() => Promise<void>>(async () => {});
    const hideSettings = vi.fn<() => Promise<void>>(async () => {});

    render(
      <HomeApp
        client={createClient(baseState, {
          minimizeSettings,
          toggleSettingsMaximized,
          hideSettings,
        })}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize or restore window' }));
    fireEvent.doubleClick(screen.getByLabelText('Window drag region'));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    expect(minimizeSettings).toHaveBeenCalledTimes(1);
    expect(toggleSettingsMaximized).toHaveBeenCalledTimes(2);
    expect(hideSettings).toHaveBeenCalledTimes(1);
  });

  it('renders Linux window controls before desktop state arrives', () => {
    render(
      <HomeApp
        client={createClient(baseState, {
          subscribeState: () => () => {},
        })}
      />,
    );

    expect(screen.getByText('Connecting to the desktop runtime...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maximize or restore window' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeTruthy();
  });

  it('refreshes home readiness when the window regains focus', async () => {
    const refreshPermissions = vi.fn<() => Promise<void>>(async () => {});

    render(<HomeApp client={createClient(baseState, { refreshPermissions })} />);

    await screen.findByText('All systems go');

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(refreshPermissions).toHaveBeenCalledTimes(1));
  });

  it('does not refresh home readiness while settings are open', async () => {
    const refreshPermissions = vi.fn<() => Promise<void>>(async () => {});

    render(<HomeApp client={createClient(baseState, { refreshPermissions })} />);

    await screen.findByText('All systems go');
    fireEvent.click(screen.getByLabelText('Settings'));
    await screen.findByRole('heading', { name: 'Settings' });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refreshPermissions).not.toHaveBeenCalled();
  });

  it('does not overlap home readiness refreshes', async () => {
    let resolveRefresh: (() => void) | null = null;
    const refreshPermissions = vi.fn<() => Promise<void>>(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    render(<HomeApp client={createClient(baseState, { refreshPermissions })} />);

    await screen.findByText('All systems go');

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(refreshPermissions).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh?.();
    });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(refreshPermissions).toHaveBeenCalledTimes(2));
  });

  it('handles failed home readiness refreshes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refreshPermissions = vi.fn<() => Promise<void>>(async () => {
      throw new Error('refresh failed');
    });

    render(<HomeApp client={createClient(baseState, { refreshPermissions })} />);

    await screen.findByText('All systems go');

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        'Toph could not refresh home readiness.',
        expect.any(Error),
      ),
    );

    consoleError.mockRestore();
  });

  it('shows the app version on home but not settings', async () => {
    render(<HomeApp client={createClient(baseState)} />);

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getByText('v0.0.2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Settings'));

    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByText('v0.0.2')).toBeNull();
  });

  it('checks for updates from the home footer', async () => {
    const checkForUpdates = vi.fn<DesktopApi['checkForUpdates']>(async () => {});
    render(<HomeApp client={createClient(baseState, { checkForUpdates })} />);

    await screen.findByRole('heading', { name: 'Toph' });
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
  });

  it('downloads an available update from the home footer', async () => {
    const downloadUpdate = vi.fn<DesktopApi['downloadUpdate']>(async () => {});
    render(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            app: {
              ...baseState.app,
              update: { kind: 'available', version: '0.0.4', releaseDate: null },
            },
          },
          { downloadUpdate },
        )}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });
    fireEvent.click(screen.getByRole('button', { name: 'Download v0.0.4' }));

    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it('shows downloading and restart update footer states', async () => {
    const restartToUpdate = vi.fn<DesktopApi['restartToUpdate']>(async () => {});
    const { rerender } = render(
      <HomeApp
        client={createClient({
          ...baseState,
          app: {
            ...baseState.app,
            update: { kind: 'downloading', version: '0.0.4', percent: 57.8 },
          },
        })}
      />,
    );

    await screen.findByRole('heading', { name: 'Toph' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Downloading 58%' }).disabled).toBe(
      true,
    );

    rerender(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            app: {
              ...baseState.app,
              update: { kind: 'ready_to_restart', version: '0.0.4' },
            },
          },
          { restartToUpdate },
        )}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(restartToUpdate).toHaveBeenCalledTimes(1));
  });

  it('shows Linux fallback update steps', async () => {
    const dismissUpdateNotice = vi.fn<DesktopApi['dismissUpdateNotice']>(async () => {});
    const openUpdateReadme = vi.fn<DesktopApi['openUpdateReadme']>(async () => {});
    render(
      <HomeApp
        client={createClient(
          {
            ...baseState,
            app: {
              ...baseState.app,
              update: {
                kind: 'linux_fallback',
                version: '0.0.4',
                reason: 'The current AppImage is not writable by this user.',
                instructions: {
                  reason: 'The current AppImage is not writable by this user.',
                  currentPath: '/opt/Toph.AppImage',
                  downloadUrl:
                    'https://github.com/YourTechBudStudio/Toph/releases/download/v0.0.4/Toph-0.0.4-linux-x86_64.AppImage',
                  readmeUrl: 'https://github.com/YourTechBudStudio/Toph#linux-installupdate',
                  commands: 'mkdir -p ~/.local/share/toph',
                },
              },
            },
          },
          { dismissUpdateNotice, openUpdateReadme },
        )}
      />,
    );

    await screen.findByRole('dialog', {
      name: 'I can’t safely replace this AppImage from here.',
    });
    expect(screen.getByText(/Current path: \/opt\/Toph.AppImage/)).toBeTruthy();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName.toLowerCase() === 'code' &&
          element.textContent ===
            'wget -O ~/.local/share/toph/Toph.AppImage "https://github.com/YourTechBudStudio/Toph/releases/download/v0.0.4/Toph-0.0.4-linux-x86_64.AppImage"\nchmod +x ~/.local/share/toph/Toph.AppImage',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open README' }));
    await waitFor(() => expect(openUpdateReadme).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(dismissUpdateNotice).toHaveBeenCalledTimes(1));
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

  it('renders recent sessions when present', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const stateWithSessions: AppState = {
      ...baseState,
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

    fireEvent.click(screen.getByText('This is a test dictation result from the mock flow.'));

    expect(screen.getByText(/Polished with the/)).toBeTruthy();
    expect(screen.getByText('Engineer')).toBeTruthy();
    expect(screen.queryByText(/hash/)).toBeNull();

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
        polish: { ...baseState.settings.polish, rulePresetId: null },
      },
    };
    const selectedState = {
      ...baseState,
      settings: {
        ...baseState.settings,
        polish: { ...baseState.settings.polish, rulePresetId: 'engineer' },
      },
    };
    const setActivePolishRulePreset = vi.fn<DesktopApi['setActivePolishRulePreset']>(
      async (rulePresetId) => {
        act(() => {
          publish?.({
            ...selectedState,
            settings: {
              ...selectedState.settings,
              polish: { ...selectedState.settings.polish, rulePresetId },
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
        polish: { ...baseState.settings.polish, rulePresetId: null },
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
              polish: { ...baseState.settings.polish, rulePresetId: null },
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
