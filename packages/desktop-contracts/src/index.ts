export const DESKTOP_IPC_CHANNELS = {
  subscribeState: 'toph:subscribe-state',
  state: 'toph:state',
  toggleCapture: 'toph:toggle-capture',
  cancelCapture: 'toph:cancel-capture',
  resizeOverlay: 'toph:resize-overlay',
  showSettings: 'toph:show-settings',
  hideSettings: 'toph:hide-settings',
  minimizeSettings: 'toph:minimize-settings',
  toggleSettingsMaximized: 'toph:toggle-settings-maximized',
  getSettingsWindowBounds: 'toph:get-settings-window-bounds',
  moveSettingsWindow: 'toph:move-settings-window',
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
  setAudioInputDevice: 'toph:set-audio-input-device',
  setAudioOutputDevice: 'toph:set-audio-output-device',
  setPolishEnabled: 'toph:set-polish-enabled',
  setTypingWpm: 'toph:set-typing-wpm',
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
  checkForUpdates: 'toph:check-for-updates',
  downloadUpdate: 'toph:download-update',
  restartToUpdate: 'toph:restart-to-update',
  dismissUpdateNotice: 'toph:dismiss-update-notice',
  openUpdateReadme: 'toph:open-update-readme',
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
  | 'copied'
  | 'no_speech'
  | 'cancelled'
  | 'failed';
export type PasteAttemptStatus = 'idle' | 'clipboard-only' | 'success' | 'failed';
export type SoundEventKind = 'start' | 'stop' | 'done';
export type ShortcutBackend = 'electron-global-shortcut' | 'gnome-custom-shortcut';
export type RuleSwitcherMode = 'idle' | 'selecting' | 'selected' | 'disabled';
export type PermissionRequirementId = 'microphone' | 'accessibility';
export type ProviderId = 'openai-sub';
export const PROVIDER_IDS: readonly ProviderId[] = ['openai-sub'];
export const DEFAULT_AUTH_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_TRANSCRIPTION_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_INFERENCE_PROVIDER_ID: ProviderId = 'openai-sub';
export const DEFAULT_TRANSCRIPTION_MODEL = 'chatgpt-backend-transcribe';
export const DEFAULT_INFERENCE_MODEL = 'gpt-5.6-luna';
export const MAX_POLISH_RULE_PRESETS = 9;
export const MAX_ENABLED_DICTIONARY_ENTRIES = 200;
export type ProviderConnectionStatus = 'missing' | 'connecting' | 'connected' | 'invalid';
export type ProviderBillingMode = 'subscription' | 'metered' | 'local' | 'unknown';
export const SYSTEM_DEFAULT_AUDIO_DEVICE_ID = 'default';
export type AudioDeviceKind = 'input' | 'output';
export function normalizeAudioDeviceLabel(label: string) {
  return label.trim().replace(/^Default\s*-\s*/i, '');
}
export type AudioDevicePreference = {
  id: typeof SYSTEM_DEFAULT_AUDIO_DEVICE_ID | string;
  label: string | null;
};
export type AudioDeviceInfo = {
  id: string;
  label: string;
  kind: AudioDeviceKind;
  isDefault: boolean;
};
export type AudioDeviceResolution = {
  preference: AudioDevicePreference;
  resolvedDeviceId: string | null;
  resolvedLabel: string;
  fallbackUsed: boolean;
  fallbackReason: 'missing-device' | null;
};
export interface ActiveInputDeviceFallback {
  selectedLabel: string | null;
  defaultLabel: string | null;
}
export interface AudioDeviceState {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
  input: AudioDeviceResolution;
  output: AudioDeviceResolution;
}
export const PROVIDER_BILLING_MODES: Record<ProviderId, ProviderBillingMode> = {
  'openai-sub': 'subscription',
};
export const PERMISSION_REQUIREMENT_IDS: readonly PermissionRequirementId[] = [
  'microphone',
  'accessibility',
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
  copiedToClipboard?: boolean;
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
  audio: {
    inputDevice: AudioDevicePreference;
    outputDevice: AudioDevicePreference;
  };
  polish: {
    enabled: boolean;
    rulePresetId: string | null;
    dictionaryDefaultsSeeded: boolean;
  };
  dashboard: {
    typingWpm: number;
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
  audio: {
    inputDevice: {
      id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
      label: null,
    },
    outputDevice: {
      id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
      label: null,
    },
  },
  polish: {
    enabled: true,
    rulePresetId: null,
    dictionaryDefaultsSeeded: false,
  },
  dashboard: {
    typingWpm: 50,
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

export type UpdateCheckTrigger = 'manual' | 'scheduled';

export interface LinuxUpdateInstructions {
  reason: string;
  currentPath: string | null;
  downloadUrl: string | null;
  readmeUrl: string;
  commands: string;
}

export type AppUpdateState =
  | {
      kind: 'idle';
      lastCheckedAt: number | null;
    }
  | {
      kind: 'checking';
      trigger: UpdateCheckTrigger;
      lastCheckedAt: number | null;
    }
  | {
      kind: 'up_to_date';
      checkedAt: number;
    }
  | {
      kind: 'available';
      version: string;
      releaseDate: string | null;
    }
  | {
      kind: 'downloading';
      version: string;
      percent: number;
    }
  | {
      kind: 'ready_to_restart';
      version: string;
    }
  | {
      kind: 'linux_fallback';
      version: string | null;
      reason: string;
      instructions: LinuxUpdateInstructions;
    }
  | {
      kind: 'failed';
      trigger: 'manual';
      message: string;
    };

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

export interface ActiveDictationFailure {
  sessionId: string | null;
  canRetry: boolean;
}

export interface AppState {
  app: {
    version: string;
    update: AppUpdateState;
  };
  phase: DictationPhase;
  activeFailure: ActiveDictationFailure | null;
  activeInputDeviceFallback: ActiveInputDeviceFallback | null;
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
  permissions: PermissionState;
  pasteSupport: PasteSupport;
  lastPasteAttempt: PasteAttempt;
  lastTranscript: string | null;
  recentSessions: DictationSessionRecord[];
  dashboardStats: DashboardStats;
  updatedAt: number;
}

export interface DesktopApi {
  platform: NodeJS.Platform;
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
  minimizeSettings: () => Promise<void>;
  toggleSettingsMaximized: () => Promise<void>;
  getSettingsWindowBounds: () => Promise<WindowBounds | null>;
  moveSettingsWindow: (position: WindowPosition) => Promise<void>;
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
  setAudioInputDevice: (device: AudioDevicePreference) => Promise<void>;
  setAudioOutputDevice: (device: AudioDevicePreference) => Promise<void>;
  setPolishEnabled: (enabled: boolean) => Promise<void>;
  setTypingWpm: (typingWpm: number) => Promise<void>;
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
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  restartToUpdate: () => Promise<void>;
  dismissUpdateNotice: () => Promise<void>;
  openUpdateReadme: () => Promise<void>;
  onSoundEvent: (listener: (kind: SoundEventKind) => void) => () => void;
  quit: () => Promise<void>;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowBounds extends WindowPosition {
  width: number;
  height: number;
}

export interface CaptureStartRequest {
  sessionId: string;
  sampleRate: number;
  inputDeviceId: string | null;
}

export interface CaptureChunkMessage {
  sessionId: string;
  chunk: ArrayBuffer;
}

export interface CaptureLifecycleMessage {
  sessionId: string;
  inputDeviceFallbackUsed?: boolean;
  inputDeviceFallbackLabel?: string | null;
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
