import type { AppState, DesktopApi } from '@toph/desktop-contracts';

/**
 * Every `DesktopApi` method as a no-op, so a test declares only the ones it asserts on.
 *
 * This exists as one copy on purpose. Three suites carried byte-identical inline versions and all
 * three broke together on the same removed methods, which is exactly the drift a shared seam
 * prevents: the next API change is a one-file edit, and a method a suite forgot to stub can no
 * longer differ between suites.
 */
export function createDesktopApiStub(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    platform: 'linux',
    subscribeState: () => () => {},
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
    setTranscriptionProvider: async () => {},
    setInferenceProvider: async () => {},
    setProviderSetting: async () => {},
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

/** A client that publishes one fixed snapshot and never updates, which is what most tests want. */
export function createStaticDesktopApiStub(
  state: AppState,
  overrides: Partial<DesktopApi> = {},
): DesktopApi {
  return createDesktopApiStub({
    platform: state.environment.platform,
    subscribeState: (listener) => {
      listener(state);
      return () => {};
    },
    ...overrides,
  });
}
