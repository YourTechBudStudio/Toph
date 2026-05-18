export const DESKTOP_IPC_CHANNELS = {
  subscribeState: 'toph:subscribe-state',
  state: 'toph:state',
  toggleCapture: 'toph:toggle-capture',
  cancelCapture: 'toph:cancel-capture',
  resizeOverlay: 'toph:resize-overlay',
  showSettings: 'toph:show-settings',
  hideSettings: 'toph:hide-settings',
  installShortcut: 'toph:install-shortcut',
  installRuleSwitcherShortcut: 'toph:install-rule-switcher-shortcut',
  suspendShortcut: 'toph:suspend-shortcut',
  resumeShortcut: 'toph:resume-shortcut',
  openRuleSwitcher: 'toph:open-rule-switcher',
  closeRuleSwitcher: 'toph:close-rule-switcher',
  selectRuleSwitcherPreset: 'toph:select-rule-switcher-preset',
  connectProvider: 'toph:connect-provider',
  submitProviderAuthorization: 'toph:submit-provider-authorization',
  removeProvider: 'toph:remove-provider',
  refreshProviders: 'toph:refresh-providers',
  setAuthProvider: 'toph:set-auth-provider',
  setTranscriptionProvider: 'toph:set-transcription-provider',
  setTranscriptionModel: 'toph:set-transcription-model',
  setInferenceProvider: 'toph:set-inference-provider',
  setInferenceModel: 'toph:set-inference-model',
  setPolishEnabled: 'toph:set-polish-enabled',
  setTypingWpm: 'toph:set-typing-wpm',
  setDiagnosticsEnabled: 'toph:set-diagnostics-enabled',
  setScreenshotContextEnabled: 'toph:set-screenshot-context-enabled',
  setDictationPromptEnabled: 'toph:set-dictation-prompt-enabled',
  setActivePolishRulePreset: 'toph:set-active-polish-rule-preset',
  createPolishRulePreset: 'toph:create-polish-rule-preset',
  updatePolishRulePreset: 'toph:update-polish-rule-preset',
  deletePolishRulePreset: 'toph:delete-polish-rule-preset',
  duplicatePolishRulePreset: 'toph:duplicate-polish-rule-preset',
  reorderPolishRulePresets: 'toph:reorder-polish-rule-presets',
  createDictionaryEntry: 'toph:create-dictionary-entry',
  updateDictionaryEntry: 'toph:update-dictionary-entry',
  deleteDictionaryEntry: 'toph:delete-dictionary-entry',
  performPermissionAction: 'toph:perform-permission-action',
  refreshPermissions: 'toph:refresh-permissions',
  rerunSession: 'toph:rerun-session',
  deleteSession: 'toph:delete-session',
  sound: 'toph:sound',
  quit: 'toph:quit',
} as const;

export const DESKTOP_CAPTURE_IPC_CHANNELS = {
  start: 'toph:capture:start',
  stop: 'toph:capture:stop',
  started: 'toph:capture:started',
  stopped: 'toph:capture:stopped',
  chunk: 'toph:capture:chunk',
  error: 'toph:capture:error',
} as const;

// Shared because the main process owns the transparent Electron window while
// the renderer owns the visible overlay geometry and requests runtime resizes.
export const OVERLAY_WINDOW_GEOMETRY = {
  width: 400,
  height: 80,
} as const;

export type ShortcutModifier = 'command' | 'control' | 'option' | 'alt' | 'shift';
export type ShortcutKey = string;

export interface ShortcutChord {
  modifiers: ShortcutModifier[];
  key: ShortcutKey;
}

export interface ShortcutCandidate {
  modifiers: ShortcutModifier[];
  keys: ShortcutKey[];
}

export type ShortcutValidationResult =
  | { valid: true; chord: ShortcutChord; errors: [] }
  | { valid: false; chord: null; errors: string[] };

export const SHORTCUT_MODIFIER_ORDER: readonly ShortcutModifier[] = [
  'command',
  'control',
  'option',
  'alt',
  'shift',
];

const shortcutModifierLabels: Record<ShortcutModifier, { darwin: string; default: string }> = {
  command: { darwin: '⌘', default: 'Super' },
  control: { darwin: '⌃', default: 'Ctrl' },
  option: { darwin: '⌥', default: 'Alt' },
  alt: { darwin: '⌥', default: 'Alt' },
  shift: { darwin: '⇧', default: 'Shift' },
};

const domCodeToShortcutKey: Record<string, ShortcutKey> = {
  Space: 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

const supportedNamedShortcutKeys = new Set<ShortcutKey>([...Object.values(domCodeToShortcutKey)]);

const electronKeyAliases: Record<ShortcutKey, string> = {
  Escape: 'Esc',
};

const gnomeKeyAliases: Record<ShortcutKey, string> = {
  Space: 'space',
  Enter: 'Return',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  Backspace: 'BackSpace',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
};

function isKnownShortcutModifier(value: string): value is ShortcutModifier {
  return SHORTCUT_MODIFIER_ORDER.includes(value as ShortcutModifier);
}

export function normalizeShortcutModifiers(
  modifiers: readonly ShortcutModifier[],
): ShortcutModifier[] {
  const unique = new Set(modifiers);
  return SHORTCUT_MODIFIER_ORDER.filter((modifier) => unique.has(modifier));
}

export function resolveDefaultShortcutChord(platform: NodeJS.Platform): ShortcutChord {
  return {
    modifiers: platform === 'darwin' ? ['control', 'option'] : ['control', 'alt'],
    key: 'Space',
  };
}

export function resolveDefaultRuleSwitcherShortcutChord(platform: NodeJS.Platform): ShortcutChord {
  return {
    modifiers: platform === 'darwin' ? ['option'] : ['control'],
    key: 'Space',
  };
}

export function resolveDefaultScreenshotContextShortcutChord(
  platform: NodeJS.Platform,
): ShortcutChord {
  return {
    modifiers: platform === 'darwin' ? ['option'] : ['alt'],
    key: 'S',
  };
}

export function resolveDefaultDictationPromptShortcutChord(
  platform: NodeJS.Platform,
): ShortcutChord {
  return {
    modifiers: platform === 'darwin' ? ['option'] : ['alt'],
    key: 'A',
  };
}

export function normalizeDomShortcutModifier(
  key: string,
  code: string,
  platform: NodeJS.Platform,
): ShortcutModifier | null {
  if (key === 'Meta' || code === 'MetaLeft' || code === 'MetaRight') {
    return 'command';
  }
  if (key === 'Control' || code === 'ControlLeft' || code === 'ControlRight') {
    return 'control';
  }
  if (key === 'Alt' || code === 'AltLeft' || code === 'AltRight') {
    return platform === 'darwin' ? 'option' : 'alt';
  }
  if (key === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight') {
    return 'shift';
  }
  return null;
}

export function normalizeDomShortcutKey(key: string, code: string): ShortcutKey | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }
  if (domCodeToShortcutKey[code]) {
    return domCodeToShortcutKey[code];
  }
  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }
  if (/^[0-9]$/.test(key)) {
    return key;
  }
  return null;
}

export function isFunctionShortcutKey(key: ShortcutKey): boolean {
  return /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
}

export function isSupportedShortcutKey(key: ShortcutKey): boolean {
  return (
    /^[A-Z]$/.test(key) ||
    /^[0-9]$/.test(key) ||
    isFunctionShortcutKey(key) ||
    supportedNamedShortcutKeys.has(key)
  );
}

export function validateShortcutCandidate(candidate: ShortcutCandidate): ShortcutValidationResult {
  const modifiers = normalizeShortcutModifiers(candidate.modifiers);
  const keys = Array.from(new Set(candidate.keys));
  const errors: string[] = [];

  if (keys.length === 0) {
    errors.push('Press one main key for the shortcut. Try Ctrl+Alt+Space or F15.');
  }
  if (keys.length > 1) {
    errors.push('Shortcuts can only use one main key. Try Ctrl+Alt+Space or F15.');
  }
  if (keys.some((key) => !isSupportedShortcutKey(key))) {
    errors.push(
      'This key is not supported for global shortcuts yet. Try a letter, number, function key, or Space.',
    );
  }
  if (
    keys.length === 1 &&
    modifiers.length === 0 &&
    !isFunctionShortcutKey(keys[0] as ShortcutKey)
  ) {
    errors.push(
      'Use at least one modifier with this key. Try Ctrl+Alt+Space, or use a function key like F15.',
    );
  }

  if (errors.length > 0) {
    return { valid: false, chord: null, errors };
  }

  const key = keys[0] as ShortcutKey;

  return {
    valid: true,
    chord: {
      modifiers,
      key,
    },
    errors: [],
  };
}

export function validateShortcutChord(chord: ShortcutChord): ShortcutValidationResult {
  return validateShortcutCandidate({ modifiers: chord.modifiers, keys: [chord.key] });
}

export function isShortcutChord(value: unknown): value is ShortcutChord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { modifiers?: unknown; key?: unknown };
  if (!Array.isArray(candidate.modifiers) || typeof candidate.key !== 'string') {
    return false;
  }

  if (
    !candidate.modifiers.every(
      (modifier) => typeof modifier === 'string' && isKnownShortcutModifier(modifier),
    )
  ) {
    return false;
  }

  return validateShortcutChord({
    modifiers: candidate.modifiers as ShortcutModifier[],
    key: candidate.key,
  }).valid;
}

export function formatShortcutKeyForDisplay(key: ShortcutKey): string {
  return key;
}

export function formatShortcutChordKeys(chord: ShortcutChord, platform: NodeJS.Platform): string[] {
  return [
    ...normalizeShortcutModifiers(chord.modifiers).map((modifier) =>
      platform === 'darwin'
        ? shortcutModifierLabels[modifier].darwin
        : shortcutModifierLabels[modifier].default,
    ),
    formatShortcutKeyForDisplay(chord.key),
  ];
}

export function formatShortcutChord(chord: ShortcutChord, platform: NodeJS.Platform): string {
  return formatShortcutChordKeys(chord, platform).join(platform === 'darwin' ? '' : '+');
}

export function shortcutChordToElectronAccelerator(
  chord: ShortcutChord,
  platform: NodeJS.Platform,
): string {
  const modifiers = normalizeShortcutModifiers(chord.modifiers).map((modifier) => {
    if (modifier === 'command') return platform === 'darwin' ? 'Command' : 'Super';
    if (modifier === 'control') return 'Control';
    if (modifier === 'option') return platform === 'darwin' ? 'Option' : 'Alt';
    if (modifier === 'alt') return platform === 'darwin' ? 'Option' : 'Alt';
    return 'Shift';
  });

  return [...modifiers, electronKeyAliases[chord.key] ?? chord.key].join('+');
}

export function shortcutChordToGnomeBinding(chord: ShortcutChord): string {
  const modifiers = normalizeShortcutModifiers(chord.modifiers).map((modifier) => {
    if (modifier === 'command') return '<Super>';
    if (modifier === 'control') return '<Primary>';
    if (modifier === 'shift') return '<Shift>';
    return '<Alt>';
  });
  const key =
    gnomeKeyAliases[chord.key] ?? (/^[A-Z]$/.test(chord.key) ? chord.key.toLowerCase() : chord.key);

  return `${modifiers.join('')}${key}`;
}

export type DictationPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'polishing'
  | 'no_speech'
  | 'failed';
export type PasteAttemptStatus = 'idle' | 'clipboard-only' | 'success' | 'failed';
export type SoundEventKind = 'start' | 'stop' | 'done';
export type ShortcutBackend = 'electron-global-shortcut' | 'gnome-custom-shortcut';
export type RuleSwitcherMode = 'idle' | 'selecting' | 'selected' | 'disabled';
export type PermissionRequirementId = 'microphone' | 'accessibility' | 'screen';
export type ProviderId = 'openai-sub' | 'antigravity';
export const PROVIDER_IDS: readonly ProviderId[] = ['openai-sub', 'antigravity'];
export const TRANSCRIPTION_PROVIDER_IDS: readonly ProviderId[] = ['openai-sub', 'antigravity'];
export const INFERENCE_PROVIDER_IDS: readonly ProviderId[] = ['openai-sub', 'antigravity'];
export const DEFAULT_AUTH_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_TRANSCRIPTION_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_INFERENCE_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_TRANSCRIPTION_MODEL = 'chatgpt-backend-transcribe';
export const DEFAULT_INFERENCE_MODEL = 'gpt-5.4-mini';
export const DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL = 'antigravity-gemini-3.1-flash-lite';
export const DEFAULT_ANTIGRAVITY_INFERENCE_MODEL = 'antigravity-gemini-3.1-flash-lite';
export const OPENAI_SUB_TRANSCRIPTION_MODELS = ['chatgpt-backend-transcribe'] as const;
export const OPENAI_SUB_INFERENCE_MODELS = ['gpt-5.4-mini'] as const;
export const ANTIGRAVITY_TRANSCRIPTION_MODELS = [
  'antigravity-gemini-3.1-flash-lite',
  'antigravity-gemini-3.1-flash-lite-minimal',
  'antigravity-gemini-3.1-flash-lite-medium',
  'antigravity-gemini-3.1-flash-lite-high',
  'antigravity-gemini-3-flash',
  'antigravity-gemini-3-flash-minimal',
  'antigravity-gemini-3-flash-medium',
  'antigravity-gemini-3-flash-high',
] as const;
export const ANTIGRAVITY_INFERENCE_MODELS = [
  'antigravity-gemini-3.1-flash-lite',
  'antigravity-gemini-3.1-flash-lite-minimal',
  'antigravity-gemini-3.1-flash-lite-medium',
  'antigravity-gemini-3.1-flash-lite-high',
  'antigravity-gemini-3.1-pro',
  'antigravity-gemini-3.1-pro-high',
  'antigravity-gemini-3-flash',
  'antigravity-gemini-3-flash-minimal',
  'antigravity-gemini-3-flash-medium',
  'antigravity-gemini-3-flash-high',
] as const;
export const MAX_POLISH_RULE_PRESETS = 9;
export type ProviderConnectionStatus = 'missing' | 'connecting' | 'connected' | 'invalid';
export type ProviderBillingMode = 'subscription' | 'metered' | 'local' | 'unknown';
export const PROVIDER_BILLING_MODES: Record<ProviderId, ProviderBillingMode> = {
  'openai-sub': 'subscription',
  antigravity: 'subscription',
};
export const PERMISSION_REQUIREMENT_IDS: readonly PermissionRequirementId[] = [
  'microphone',
  'accessibility',
  'screen',
];
export type PermissionRequirementStatus =
  | 'granted'
  | 'missing'
  | 'promptable'
  | 'denied'
  | 'not-required'
  | 'unknown';
export type PermissionRequirementAction = 'request' | 'open-settings' | 'recheck' | 'none';

export interface PasteSupport {
  helper: string | null;
  detail: string;
}

export interface PasteAttempt {
  helper: string | null;
  status: PasteAttemptStatus;
  detail: string;
}

export type DictationSessionStatus =
  | 'recorded'
  | 'segmented'
  | 'completed'
  | 'failed'
  | 'no_speech'
  | 'recording_failed';

export interface DictationSessionOutputRecord {
  id: string;
  text: string;
  kind: 'raw_concat' | 'polished';
  rulePresetId: string | null;
  rulePresetHash: string | null;
  createdAt: number;
}

export interface DictationSessionRecord {
  id: string;
  status: DictationSessionStatus;
  createdAt: number;
  errorMessage: string | null;
  errorReport: string | null;
  canRetry: boolean;
  selectedOutput: DictationSessionOutputRecord | null;
  pasteStatus: PasteAttemptStatus;
  pasteDetail: string;
  dictationPromptText?: string | null;
  screenshots?: ScreenshotContextImage[];
  diagnostics?: {
    sessionId: string;
    outputId: string | null;
    outputKind: 'raw_concat' | 'polished' | null;
    sessionStartedAt: number;
    sessionEndedAt: number | null;
    sessionDurationMs: number | null;
    dictationPromptTextPath: string | null;
    dictationPromptCharacterCount: number;
    screenshotCount: number;
    screenshotDirectory: string | null;
  };
}

export interface PolishRulePresetSummary {
  id: string;
  title: string;
  description: string;
  body: string;
  bodyHash: string;
  sortOrder: number;
}

export interface PolishRulePresetDraft {
  title: string;
  description: string;
  body: string;
}

export interface ShortcutRegistrationState {
  chord: ShortcutChord;
  accelerator: string;
  label: string;
  registered: boolean;
  backend: ShortcutBackend;
  detail: string;
  installable: boolean;
  installed: boolean;
}

export interface DictionaryEntrySummary {
  id: string;
  term: string;
  hint: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DictionaryEntryDraft {
  term: string;
  hint: string | null;
  enabled: boolean;
}

export type ScreenshotContextStatus =
  | 'disabled'
  | 'ready'
  | 'capturing'
  | 'permission-needed'
  | 'unavailable'
  | 'error';
export type ScreenshotContextAction = 'none' | 'request' | 'open-settings';
export type ScreenshotContextImageDetail = 'low' | 'high' | 'auto';

export interface ScreenshotContextDuplicateReference {
  capturedAt: number;
  referencePath: string;
  meanAbsoluteDifference: number;
  changedPixelRatio: number;
}

export interface ScreenshotContextImage {
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  detail: ScreenshotContextImageDetail;
  capturedAt: number;
  width?: number;
  height?: number;
  byteSize?: number;
  duplicateReferences?: ScreenshotContextDuplicateReference[];
}

export interface ScreenshotContextState {
  enabled: boolean;
  status: ScreenshotContextStatus;
  detail: string;
  action: ScreenshotContextAction;
  capturedCount: number;
}

export type DictationPromptStatus =
  | 'disabled'
  | 'ready'
  | 'capturing'
  | 'captured'
  | 'ignored'
  | 'error';

export interface DictationPromptState {
  enabled: boolean;
  status: DictationPromptStatus;
  detail: string;
  capturedDurationMs: number;
}

export interface PolishState {
  rulePresets: PolishRulePresetSummary[];
  dictionary: DictionaryEntrySummary[];
}

export interface AppSettings {
  version: 1;
  shortcut: {
    chord: ShortcutChord;
  };
  ruleSwitcherShortcut: {
    chord: ShortcutChord;
  };
  auth: {
    providerId: ProviderId;
  };
  transcription: {
    providerId: ProviderId;
    model: string;
  };
  inference: {
    providerId: ProviderId;
    model: string;
  };
  polish: {
    enabled: boolean;
    rulePresetId: string | null;
  };
  context: {
    screenshots: {
      enabled: boolean;
    };
    dictationPrompt: {
      enabled: boolean;
    };
  };
  dashboard: {
    typingWpm: number;
  };
  diagnostics: {
    enabled: boolean;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  shortcut: {
    chord: {
      modifiers: ['control', 'alt'],
      key: 'Space',
    },
  },
  ruleSwitcherShortcut: {
    chord: {
      modifiers: ['control'],
      key: 'Space',
    },
  },
  auth: {
    providerId: DEFAULT_AUTH_PROVIDER_ID,
  },
  transcription: {
    providerId: DEFAULT_TRANSCRIPTION_PROVIDER_ID,
    model: DEFAULT_TRANSCRIPTION_MODEL,
  },
  inference: {
    providerId: DEFAULT_INFERENCE_PROVIDER_ID,
    model: DEFAULT_INFERENCE_MODEL,
  },
  polish: {
    enabled: true,
    rulePresetId: null,
  },
  context: {
    screenshots: {
      enabled: false,
    },
    dictationPrompt: {
      enabled: false,
    },
  },
  dashboard: {
    typingWpm: 50,
  },
  diagnostics: {
    enabled: false,
  },
};

export interface DashboardStats {
  rollingWindowDays: number;
  words: number;
  averageSpokenWpm: number | null;
  timeSavedMinutes: number;
  meteredSpendUsdMicros: number;
  subscriptionEstimatedCostUsdMicros: number;
  totalEstimatedCostUsdMicros: number;
  costEstimateIncomplete: boolean;
}

export interface PermissionRequirement {
  id: PermissionRequirementId;
  label: string;
  status: PermissionRequirementStatus;
  required: boolean;
  detail: string;
  action: PermissionRequirementAction;
}

export interface PermissionState {
  ready: boolean;
  requirements: PermissionRequirement[];
}

export interface ProviderConnection {
  id: ProviderId;
  label: string;
  description: string;
  billingMode: ProviderBillingMode;
  status: ProviderConnectionStatus;
  accountId: string | null;
  expires: number | null;
  error: string | null;
}

export interface ProviderState {
  ready: boolean;
  selectedProviderId: ProviderId | null;
  providers: ProviderConnection[];
}

export type VadRuntimeStatus =
  | {
      kind: 'ready';
      activeAnalyzer: 'silero';
      detail: string;
    }
  | {
      kind: 'degraded';
      activeAnalyzer: 'energy';
      detail: string;
    };

export interface AppState {
  phase: DictationPhase;
  shortcut: ShortcutRegistrationState;
  ruleSwitcherShortcut: ShortcutRegistrationState;
  ruleSwitcher: {
    mode: RuleSwitcherMode;
    selectedRulePresetId: string | null;
    message: string | null;
  };
  environment: {
    platform: NodeJS.Platform;
    sessionType: string;
    currentDesktop: string;
  };
  providers: ProviderState;
  vad: VadRuntimeStatus;
  settings: AppSettings;
  polish: PolishState;
  context: {
    screenshots: ScreenshotContextState;
    dictationPrompt: DictationPromptState;
  };
  permissions: PermissionState;
  pasteSupport: PasteSupport;
  lastPasteAttempt: PasteAttempt;
  lastTranscript: string | null;
  recentSessions: DictationSessionRecord[];
  dashboardStats: DashboardStats;
  updatedAt: number;
}

export interface DesktopApi {
  /**
   * Subscribe to the desktop state stream.
   * The listener receives the current snapshot first, then later updates in send order.
   */
  subscribeState: (listener: (state: AppState) => void) => () => void;
  toggleCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  resizeOverlay: (size: OverlaySize) => Promise<void>;
  showSettings: () => Promise<void>;
  hideSettings: () => Promise<void>;
  installShortcut: (chord: ShortcutChord) => Promise<void>;
  installRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<void>;
  suspendShortcut: () => Promise<void>;
  resumeShortcut: () => Promise<void>;
  openRuleSwitcher: () => Promise<void>;
  closeRuleSwitcher: () => Promise<void>;
  selectRuleSwitcherPreset: (rulePresetId: string) => Promise<void>;
  connectProvider: (providerId: ProviderId) => Promise<void>;
  submitProviderAuthorization: (providerId: ProviderId, input: string) => Promise<void>;
  removeProvider: (providerId: ProviderId) => Promise<void>;
  refreshProviders: () => Promise<void>;
  setAuthProvider: (providerId: ProviderId) => Promise<void>;
  setTranscriptionProvider: (providerId: ProviderId) => Promise<void>;
  setTranscriptionModel: (model: string) => Promise<void>;
  setInferenceProvider: (providerId: ProviderId) => Promise<void>;
  setInferenceModel: (model: string) => Promise<void>;
  setPolishEnabled: (enabled: boolean) => Promise<void>;
  setTypingWpm: (typingWpm: number) => Promise<void>;
  setDiagnosticsEnabled: (enabled: boolean) => Promise<void>;
  setScreenshotContextEnabled: (enabled: boolean) => Promise<void>;
  setDictationPromptEnabled: (enabled: boolean) => Promise<void>;
  setActivePolishRulePreset: (rulePresetId: string) => Promise<void>;
  createPolishRulePreset: (draft: PolishRulePresetDraft) => Promise<void>;
  updatePolishRulePreset: (id: string, draft: PolishRulePresetDraft) => Promise<void>;
  deletePolishRulePreset: (id: string) => Promise<void>;
  duplicatePolishRulePreset: (id: string) => Promise<void>;
  reorderPolishRulePresets: (ids: string[]) => Promise<void>;
  createDictionaryEntry: (draft: DictionaryEntryDraft) => Promise<void>;
  updateDictionaryEntry: (id: string, draft: DictionaryEntryDraft) => Promise<void>;
  deleteDictionaryEntry: (id: string) => Promise<void>;
  performPermissionAction: (permissionId: PermissionRequirementId) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  rerunSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  onSoundEvent: (listener: (kind: SoundEventKind) => void) => () => void;
  quit: () => Promise<void>;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface CaptureStartRequest {
  sessionId: string;
  sampleRate: number;
}

export interface CaptureChunkMessage {
  sessionId: string;
  chunk: ArrayBuffer;
}

export interface CaptureLifecycleMessage {
  sessionId: string;
}

export interface CaptureErrorMessage {
  sessionId: string | null;
  message: string;
}

export interface CaptureRendererApi {
  onStart: (listener: (request: CaptureStartRequest) => void) => () => void;
  onStop: (listener: () => void) => () => void;
  sendStarted: (message: CaptureLifecycleMessage) => void;
  sendStopped: (message: CaptureLifecycleMessage) => void;
  sendChunk: (message: CaptureChunkMessage) => void;
  sendError: (message: CaptureErrorMessage) => void;
}
