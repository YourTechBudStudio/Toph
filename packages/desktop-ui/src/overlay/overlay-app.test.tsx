import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

import type { AppState, DesktopApi } from '@toph/desktop-contracts';

import { OverlayApp } from './overlay-app';

const baseState: AppState = {
  phase: 'transcribing',
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
    status: 'success',
    detail: 'Transcript copied to the clipboard and paste was attempted with ydotool.',
  },
  lastTranscript: 'hello',
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

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestResizeObserver,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('OverlayApp', () => {
  it('renders the idle ready indicator', async () => {
    render(
      <OverlayApp client={createClient({ ...baseState, phase: 'idle' })} soundsEnabled={false} />,
    );

    await screen.findByLabelText('Toph ready');
  });

  it('renders the transcribing state without Electron globals', async () => {
    render(<OverlayApp client={createClient(baseState)} soundsEnabled={false} />);

    await screen.findByRole('heading', { name: 'Transcribing...' });
  });

  it('renders the polishing state', async () => {
    render(
      <OverlayApp
        client={createClient({ ...baseState, phase: 'polishing' })}
        soundsEnabled={false}
      />,
    );

    await screen.findByRole('heading', { name: 'Polishing...' });
  });

  it('cancels active dictation from the overlay button', async () => {
    const cancelCapture = vi.fn<() => Promise<void>>(async () => {});
    render(
      <OverlayApp client={createClient(baseState, { cancelCapture })} soundsEnabled={false} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel dictation' }));

    expect(cancelCapture).toHaveBeenCalledOnce();
  });

  it('sizes the rule switcher from content instead of the current overlay viewport', async () => {
    const selectRuleSwitcherPreset = vi.fn<DesktopApi['selectRuleSwitcherPreset']>(async () => {});
    const resizeOverlay = vi.fn<DesktopApi['resizeOverlay']>(async () => {});
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.tagName === 'SECTION') {
          return {
            x: 0,
            y: 0,
            width: 840,
            height: 168,
            top: 0,
            right: 840,
            bottom: 168,
            left: 0,
            toJSON: () => ({}),
          };
        }

        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON: () => ({}),
        };
      },
    );
    const state: AppState = {
      ...baseState,
      phase: 'idle',
      ruleSwitcher: { mode: 'selecting', selectedRulePresetId: null, message: null },
      polish: {
        ...baseState.polish,
        rulePresets: Array.from({ length: 6 }, (_, index) => ({
          id: `rule-${index + 1}`,
          title: `Rule ${index + 1}`,
          description: 'Keeps the prose goblin pointed at the right target.',
          body: 'Rules',
          bodyHash: 'hash',
          sortOrder: index,
        })),
      },
    };

    render(
      <OverlayApp
        client={createClient(state, { resizeOverlay, selectRuleSwitcherPreset })}
        soundsEnabled={false}
      />,
    );

    const overlay = await screen.findByLabelText('Toph active');
    expect(overlay.style.getPropertyValue('--rule-switcher-width')).toBe('840px');
    expect(resizeOverlay).toHaveBeenCalledWith({ width: 872, height: 192 });

    fireEvent.keyDown(window, { key: '6' });
    expect(selectRuleSwitcherPreset).toHaveBeenCalledWith('rule-6');
  });
});
