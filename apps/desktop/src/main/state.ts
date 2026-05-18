import {
  DEFAULT_APP_SETTINGS,
  PROVIDER_BILLING_MODES,
  formatShortcutChord,
  resolveDefaultShortcutChord,
  resolveDefaultRuleSwitcherShortcutChord,
  shortcutChordToElectronAccelerator,
  type AppState,
  type AppSettings,
  type DashboardStats,
  type DictationSessionRecord,
  type DictationPromptState,
  type DictationPhase,
  type PasteAttempt,
  type PasteSupport,
  type PermissionState,
  type PolishState,
  type ProviderState,
  type ScreenshotContextState,
  type ShortcutChord,
  type ShortcutRegistrationState,
  type VadRuntimeStatus,
} from '@toph/desktop-contracts';

export interface ShortcutStateSupport {
  backend: AppState['shortcut']['backend'];
  registered: boolean;
  installable: boolean;
  installed: boolean;
  detail: string;
}

export interface DesktopStateStore {
  getState: () => AppState;
  subscribe: (listener: (state: AppState) => void) => () => void;
  setShortcut: (
    kind: 'dictation' | 'ruleSwitcher',
    chord: ShortcutChord,
    support: ShortcutStateSupport,
  ) => void;
  openRuleSwitcher: () => void;
  showRuleSwitcherSelected: (rulePresetId: string, message: string) => void;
  showRuleSwitcherDisabled: () => void;
  closeRuleSwitcher: () => void;
  setProviders: (providers: ProviderState) => void;
  setSettings: (settings: AppSettings) => void;
  setPolish: (polish: PolishState) => void;
  setScreenshotContext: (context: ScreenshotContextState) => void;
  setDictationPrompt: (context: DictationPromptState) => void;
  setPermissions: (permissions: PermissionState) => void;
  setVadRuntimeStatus: (status: VadRuntimeStatus) => void;
  setPasteSupport: (pasteSupport: PasteSupport) => void;
  setRecentSessions: (sessions: DictationSessionRecord[]) => void;
  setDashboardStats: (dashboardStats: DashboardStats) => void;
  setPhase: (phase: DictationPhase) => void;
  startListening: () => void;
  startTranscribing: () => void;
  startPolishing: () => void;
  completeRecording: () => void;
  noSpeechDetected: () => void;
  failDictation: (detail: string) => void;
  completeTranscription: (
    transcript: string,
    pasteAttempt: PasteAttempt,
    options?: {
      id?: string;
      createdAt?: number;
      sessionId?: string;
      kind?: NonNullable<DictationSessionRecord['selectedOutput']>['kind'];
      rulePresetId?: string | null;
      rulePresetHash?: string | null;
    },
  ) => void;
}

function createInitialState(): AppState {
  const defaultShortcutChord = resolveDefaultShortcutChord(process.platform);
  const defaultRuleSwitcherShortcutChord = resolveDefaultRuleSwitcherShortcutChord(
    process.platform,
  );
  const toShortcutState = (chord: ShortcutChord, detail: string): ShortcutRegistrationState => ({
    chord,
    accelerator: shortcutChordToElectronAccelerator(chord, process.platform),
    label: formatShortcutChord(chord, process.platform),
    registered: false,
    backend: 'electron-global-shortcut',
    detail,
    installable: false,
    installed: false,
  });

  return {
    phase: 'idle',
    shortcut: toShortcutState(defaultShortcutChord, 'Inspecting dictation shortcut support...'),
    ruleSwitcherShortcut: toShortcutState(
      defaultRuleSwitcherShortcutChord,
      'Inspecting rule switcher shortcut support...',
    ),
    ruleSwitcher: {
      mode: 'idle',
      selectedRulePresetId: null,
      message: null,
    },
    environment: {
      platform: process.platform,
      sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
      currentDesktop: process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? 'unknown',
    },
    providers: {
      ready: false,
      selectedProviderId: null,
      providers: [
        {
          id: 'openai-sub',
          label: 'OpenAI (ChatGPT Plus/Pro subscription)',
          description: 'Use your ChatGPT subscription to transcribe recordings and polish output.',
          billingMode: PROVIDER_BILLING_MODES['openai-sub'],
          status: 'missing',
          accountId: null,
          expires: null,
          error: null,
        },
        {
          id: 'antigravity',
          label: 'Google Antigravity OAuth',
          description:
            'Use unofficial Antigravity OAuth for Gemini transcription and polish inference.',
          billingMode: PROVIDER_BILLING_MODES.antigravity,
          status: 'missing',
          accountId: null,
          expires: null,
          error: null,
        },
      ],
    },
    vad: {
      kind: 'ready',
      activeAnalyzer: 'silero',
      detail: 'Voice activity detection is ready.',
    },
    settings: DEFAULT_APP_SETTINGS,
    polish: {
      rulePresets: [],
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
      ready: process.platform !== 'darwin',
      requirements: [],
    },
    pasteSupport: {
      helper: null,
      detail: 'Inspecting clipboard and paste capabilities...',
    },
    lastPasteAttempt: {
      helper: null,
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
    updatedAt: Date.now(),
  };
}

export function createDesktopStateStore(): DesktopStateStore {
  const state = createInitialState();
  const listeners = new Set<(state: AppState) => void>();

  const publish = () => {
    state.updatedAt = Date.now();
    for (const listener of listeners) {
      listener(state);
    }
  };

  const commit = (update: (draft: AppState) => void) => {
    update(state);
    publish();
  };

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setShortcut(kind, chord, support) {
      commit((draft) => {
        const next = {
          chord,
          accelerator: shortcutChordToElectronAccelerator(chord, process.platform),
          label: formatShortcutChord(chord, process.platform),
          ...support,
        };
        if (kind === 'dictation') {
          draft.shortcut = next;
          return;
        }
        draft.ruleSwitcherShortcut = next;
      });
    },

    openRuleSwitcher() {
      commit((draft) => {
        draft.ruleSwitcher = { mode: 'selecting', selectedRulePresetId: null, message: null };
      });
    },

    showRuleSwitcherSelected(rulePresetId, message) {
      commit((draft) => {
        draft.ruleSwitcher = { mode: 'selected', selectedRulePresetId: rulePresetId, message };
      });
    },

    showRuleSwitcherDisabled() {
      commit((draft) => {
        draft.ruleSwitcher = {
          mode: 'disabled',
          selectedRulePresetId: null,
          message: "Can't switch rules while the prose engine is unplugged.",
        };
      });
    },

    closeRuleSwitcher() {
      commit((draft) => {
        draft.ruleSwitcher = { mode: 'idle', selectedRulePresetId: null, message: null };
      });
    },

    setProviders(providers) {
      commit((draft) => {
        draft.providers = providers;
      });
    },

    setSettings(settings) {
      commit((draft) => {
        draft.settings = settings;
      });
    },

    setPolish(polish) {
      commit((draft) => {
        draft.polish = polish;
      });
    },

    setScreenshotContext(context) {
      commit((draft) => {
        draft.context.screenshots = context;
      });
    },

    setDictationPrompt(context) {
      commit((draft) => {
        draft.context.dictationPrompt = context;
      });
    },

    setPermissions(permissions) {
      commit((draft) => {
        draft.permissions = permissions;
      });
    },

    setVadRuntimeStatus(status) {
      commit((draft) => {
        draft.vad = status;
      });
    },

    setPasteSupport(pasteSupport) {
      commit((draft) => {
        draft.pasteSupport = pasteSupport;
      });
    },

    setRecentSessions(sessions) {
      commit((draft) => {
        draft.recentSessions = sessions.slice(0, 8);
        draft.lastTranscript =
          sessions.find((session) => session.selectedOutput)?.selectedOutput?.text ?? null;
      });
    },

    setDashboardStats(dashboardStats) {
      commit((draft) => {
        draft.dashboardStats = dashboardStats;
      });
    },

    setPhase(phase) {
      commit((draft) => {
        draft.phase = phase;
      });
    },

    startListening() {
      commit((draft) => {
        draft.phase = 'listening';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'idle',
          detail: 'Recording microphone audio...',
        };
      });
    },

    startTranscribing() {
      commit((draft) => {
        draft.phase = 'transcribing';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'idle',
          detail: 'Processing recording...',
        };
      });
    },

    startPolishing() {
      commit((draft) => {
        draft.phase = 'polishing';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'idle',
          detail: 'Polishing transcript...',
        };
      });
    },

    completeRecording() {
      commit((draft) => {
        draft.phase = 'idle';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'idle',
          detail: 'Recording transcribed locally. Transcript assembly is not enabled yet.',
        };
      });
    },

    noSpeechDetected() {
      commit((draft) => {
        draft.phase = 'no_speech';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'idle',
          detail: 'No speech detected.',
        };
      });
    },

    failDictation(detail) {
      commit((draft) => {
        draft.phase = 'failed';
        draft.lastPasteAttempt = {
          helper: draft.lastPasteAttempt.helper,
          status: 'failed',
          detail,
        };
      });
    },

    completeTranscription(transcript, pasteAttempt, options) {
      commit((draft) => {
        const createdAt = options?.createdAt ?? Date.now();
        const sessionId = options?.sessionId;
        const selectedOutput = {
          id: options?.id ?? `${createdAt}`,
          text: transcript,
          kind: options?.kind ?? 'raw_concat',
          rulePresetId: options?.rulePresetId ?? null,
          rulePresetHash: options?.rulePresetHash ?? null,
          createdAt,
        };
        const nextSession: DictationSessionRecord = {
          id: sessionId ?? selectedOutput.id,
          status: 'completed',
          createdAt,
          errorMessage: null,
          errorReport: null,
          canRetry: true,
          selectedOutput,
          pasteStatus: pasteAttempt.status,
          pasteDetail: pasteAttempt.detail,
        };

        draft.phase = 'idle';
        draft.lastTranscript = transcript;
        draft.lastPasteAttempt = pasteAttempt;
        draft.recentSessions = [
          nextSession,
          ...draft.recentSessions.filter((session) => session.id !== nextSession.id),
        ].slice(0, 8);
      });
    },
  };
}
