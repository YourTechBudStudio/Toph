import { act, renderHook } from '@testing-library/react';

import type { AppState, DesktopApi } from '@toph/desktop-contracts';

import { useDesktopState, useRelativeTime } from './use-desktop-state';

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

function createClient(
  onSubscribe: (listener: (state: AppState) => void) => () => void,
): DesktopApi {
  return {
    subscribeState: onSubscribe,
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
  };
}

describe('useDesktopState', () => {
  it('starts empty, applies streamed snapshots, and unsubscribes on cleanup', () => {
    let publish: ((state: AppState) => void) | null = null;
    const unsubscribe = vi.fn<() => void>();
    const client = createClient((listener) => {
      publish = listener;
      return unsubscribe;
    });

    const { result, unmount } = renderHook(() => useDesktopState(client));

    expect(result.current).toBeNull();

    act(() => {
      publish?.(baseState);
    });

    expect(result.current).toEqual(baseState);

    act(() => {
      publish?.({
        ...baseState,
        phase: 'listening',
        updatedAt: 2,
      });
    });

    expect(result.current?.phase).toBe('listening');

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useRelativeTime', () => {
  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const { result } = renderHook(() => useRelativeTime(Date.now() - 10_000));
    expect(result.current).toBe('just now');
  });

  it('returns minutes for timestamps between 1 and 59 minutes ago', () => {
    const { result } = renderHook(() => useRelativeTime(Date.now() - 5 * 60_000));
    expect(result.current).toBe('5 min ago');
  });

  it('returns hours for timestamps between 1 and 23 hours ago', () => {
    const { result } = renderHook(() => useRelativeTime(Date.now() - 3 * 3_600_000));
    expect(result.current).toBe('3 hrs ago');
  });

  it('returns "yesterday" for timestamps between 24 and 47 hours ago', () => {
    const { result } = renderHook(() => useRelativeTime(Date.now() - 30 * 3_600_000));
    expect(result.current).toBe('yesterday');
  });
});
