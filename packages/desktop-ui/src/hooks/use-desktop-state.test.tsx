import { act, renderHook } from '@testing-library/react';

import type { AppState, DesktopApi } from '@toph/desktop-contracts';

import { createDesktopApiStub } from '../test-support/desktop-api-stub';
import { useDesktopState, useRelativeTime } from './use-desktop-state';

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
    providers: [
      {
        id: 'openai-sub',
        label: 'OpenAI (ChatGPT Plus/Pro subscription)',
        description: 'Use your ChatGPT subscription to transcribe recordings.',
        billingMode: 'subscription',
        roles: ['transcription', 'inference'],
        auth: { kind: 'oauth' },
        settingsFields: { provider: [], transcription: [], inference: [] },
        connectionSummary: {},
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
    transcription: { providerId: 'openai-sub' },
    inference: { providerId: 'openai-sub' },
    providers: {
      'openai-sub': {
        provider: {},
        transcription: { model: 'chatgpt-backend-transcribe' },
        inference: { model: 'gpt-5.4-mini', reasoningEffort: 'medium' },
      },
      openai: {
        provider: {},
        transcription: { model: 'gpt-4o-transcribe' },
        inference: { model: 'gpt-5.4-mini', api: 'chat', reasoningEffort: '' },
      },
    },
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

function createClient(
  onSubscribe: (listener: (state: AppState) => void) => () => void,
): DesktopApi {
  return createDesktopApiStub({
    platform: baseState.environment.platform,
    subscribeState: onSubscribe,
  });
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
