import { ipcMain } from 'electron';

import {
  DESKTOP_IPC_CHANNELS,
  isShortcutChord,
  PERMISSION_REQUIREMENT_IDS,
  PROVIDER_IDS,
  validateShortcutChord,
  type AppState,
  type DictionaryEntryDraft,
  type OverlaySize,
  type PermissionRequirementId,
  type PolishRulePresetDraft,
  type ProviderId,
  type ShortcutChord,
} from '@toph/desktop-contracts';

function isPermissionRequirementId(value: unknown): value is PermissionRequirementId {
  return (
    typeof value === 'string' &&
    PERMISSION_REQUIREMENT_IDS.includes(value as PermissionRequirementId)
  );
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

function isPolishRulePresetDraft(value: unknown): value is PolishRulePresetDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const draft = value as Partial<PolishRulePresetDraft>;
  return (
    typeof draft.title === 'string' &&
    typeof draft.description === 'string' &&
    typeof draft.body === 'string'
  );
}

function isDictionaryEntryDraft(value: unknown): value is DictionaryEntryDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const draft = value as Partial<DictionaryEntryDraft>;
  return (
    typeof draft.term === 'string' &&
    (typeof draft.hint === 'string' || draft.hint === null) &&
    typeof draft.enabled === 'boolean'
  );
}

export function registerDesktopIpc(options: {
  getState: () => AppState;
  toggleCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  resizeOverlay: (size: OverlaySize) => void;
  showSettings: () => void;
  hideSettings: () => void;
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
  setHideFromScreenCapture: (enabled: boolean) => Promise<void>;
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
  quit: () => void;
}) {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.subscribeState, (event) => {
    event.sender.send(DESKTOP_IPC_CHANNELS.state, options.getState());
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.toggleCapture, async () => {
    await options.toggleCapture();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.cancelCapture, async () => {
    await options.cancelCapture();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.resizeOverlay, async (_event, size: unknown) => {
    if (
      typeof size !== 'object' ||
      size === null ||
      !Number.isFinite((size as OverlaySize).width) ||
      !Number.isFinite((size as OverlaySize).height)
    ) {
      throw new Error('Invalid overlay size.');
    }

    options.resizeOverlay(size as OverlaySize);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.showSettings, async () => {
    options.showSettings();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.hideSettings, async () => {
    options.hideSettings();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.installShortcut, async (_event, chord: unknown) => {
    if (!isShortcutChord(chord)) {
      throw new Error('Invalid shortcut.');
    }

    const validation = validateShortcutChord(chord);
    if (!validation.valid) {
      throw new Error('Invalid shortcut.');
    }

    await options.installShortcut(validation.chord);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.installRuleSwitcherShortcut,
    async (_event, chord: unknown) => {
      if (!isShortcutChord(chord)) {
        throw new Error('Invalid shortcut.');
      }

      const validation = validateShortcutChord(chord);
      if (!validation.valid) {
        throw new Error('Invalid shortcut.');
      }

      await options.installRuleSwitcherShortcut(validation.chord);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.suspendShortcut, async () => {
    await options.suspendShortcut();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.resumeShortcut, async () => {
    await options.resumeShortcut();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.openRuleSwitcher, async () => {
    await options.openRuleSwitcher();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.closeRuleSwitcher, async () => {
    await options.closeRuleSwitcher();
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.selectRuleSwitcherPreset,
    async (_event, rulePresetId: unknown) => {
      if (typeof rulePresetId !== 'string' || rulePresetId.trim().length === 0) {
        throw new Error('Invalid Polish rule preset.');
      }

      await options.selectRuleSwitcherPreset(rulePresetId);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.connectProvider, async (_event, providerId: unknown) => {
    if (!isProviderId(providerId)) {
      throw new Error('Unknown provider.');
    }

    await options.connectProvider(providerId);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.submitProviderAuthorization,
    async (_event, providerId: unknown, input: unknown) => {
      if (!isProviderId(providerId) || typeof input !== 'string') {
        throw new Error('Unknown provider authorization request.');
      }

      await options.submitProviderAuthorization(providerId, input);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.removeProvider, async (_event, providerId: unknown) => {
    if (!isProviderId(providerId)) {
      throw new Error('Unknown provider.');
    }

    await options.removeProvider(providerId);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.refreshProviders, async () => {
    await options.refreshProviders();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setAuthProvider, async (_event, providerId: unknown) => {
    if (!isProviderId(providerId)) {
      throw new Error('Unknown auth provider.');
    }
    await options.setAuthProvider(providerId);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.setTranscriptionProvider,
    async (_event, providerId: unknown) => {
      if (!isProviderId(providerId)) {
        throw new Error('Unknown transcription provider.');
      }
      await options.setTranscriptionProvider(providerId);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setTranscriptionModel, async (_event, model: unknown) => {
    if (typeof model !== 'string') {
      throw new Error('Invalid transcription model.');
    }
    await options.setTranscriptionModel(model);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setInferenceProvider, async (_event, providerId: unknown) => {
    if (!isProviderId(providerId)) {
      throw new Error('Unknown inference provider.');
    }
    await options.setInferenceProvider(providerId);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setInferenceModel, async (_event, model: unknown) => {
    if (typeof model !== 'string') {
      throw new Error('Invalid inference model.');
    }
    await options.setInferenceModel(model);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setPolishEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid Polish enabled setting.');
    }

    await options.setPolishEnabled(enabled);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setTypingWpm, async (_event, typingWpm: unknown) => {
    if (
      typeof typingWpm !== 'number' ||
      !Number.isFinite(typingWpm) ||
      typingWpm < 20 ||
      typingWpm > 200
    ) {
      throw new Error('Invalid typing speed.');
    }

    await options.setTypingWpm(Math.round(typingWpm));
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setDiagnosticsEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid diagnostics setting.');
    }

    await options.setDiagnosticsEnabled(enabled);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.setHideFromScreenCapture,
    async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid screen capture privacy setting.');
      }

      await options.setHideFromScreenCapture(enabled);
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.setScreenshotContextEnabled,
    async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid screenshot context setting.');
      }

      await options.setScreenshotContextEnabled(enabled);
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.setDictationPromptEnabled,
    async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid Dictation Prompt setting.');
      }

      await options.setDictationPromptEnabled(enabled);
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.setActivePolishRulePreset,
    async (_event, rulePresetId: unknown) => {
      if (typeof rulePresetId !== 'string' || rulePresetId.trim().length === 0) {
        throw new Error('Invalid Polish rule preset.');
      }

      await options.setActivePolishRulePreset(rulePresetId);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.createPolishRulePreset, async (_event, draft: unknown) => {
    if (!isPolishRulePresetDraft(draft)) {
      throw new Error('Invalid Polish rule preset.');
    }

    await options.createPolishRulePreset(draft);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.updatePolishRulePreset,
    async (_event, id: unknown, draft: unknown) => {
      if (typeof id !== 'string' || id.trim().length === 0 || !isPolishRulePresetDraft(draft)) {
        throw new Error('Invalid Polish rule preset.');
      }

      await options.updatePolishRulePreset(id, draft);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.deletePolishRulePreset, async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Invalid Polish rule preset.');
    }

    await options.deletePolishRulePreset(id);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.duplicatePolishRulePreset, async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Invalid Polish rule preset.');
    }

    await options.duplicatePolishRulePreset(id);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.reorderPolishRulePresets, async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      throw new Error('Invalid Polish rule order.');
    }

    await options.reorderPolishRulePresets(ids);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.createDictionaryEntry, async (_event, draft: unknown) => {
    if (!isDictionaryEntryDraft(draft)) {
      throw new Error('Invalid dictionary entry.');
    }

    await options.createDictionaryEntry(draft);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.updateDictionaryEntry,
    async (_event, id: unknown, draft: unknown) => {
      if (typeof id !== 'string' || id.trim().length === 0 || !isDictionaryEntryDraft(draft)) {
        throw new Error('Invalid dictionary entry.');
      }

      await options.updateDictionaryEntry(id, draft);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.deleteDictionaryEntry, async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Invalid dictionary entry.');
    }

    await options.deleteDictionaryEntry(id);
  });
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.performPermissionAction,
    async (_event, permissionId: unknown) => {
      if (!isPermissionRequirementId(permissionId)) {
        throw new Error('Unknown permission action.');
      }

      await options.performPermissionAction(permissionId);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.refreshPermissions, async () => {
    await options.refreshPermissions();
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.rerunSession, async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new Error('Invalid session.');
    }

    await options.rerunSession(sessionId);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.deleteSession, async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new Error('Invalid session.');
    }

    await options.deleteSession(sessionId);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.quit, async () => {
    options.quit();
  });

  return () => {
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.subscribeState);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.toggleCapture);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.cancelCapture);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.resizeOverlay);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.showSettings);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.hideSettings);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.installShortcut);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.installRuleSwitcherShortcut);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.suspendShortcut);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.resumeShortcut);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.openRuleSwitcher);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.closeRuleSwitcher);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.selectRuleSwitcherPreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.connectProvider);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.submitProviderAuthorization);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.removeProvider);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.refreshProviders);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setAuthProvider);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setTranscriptionProvider);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setTranscriptionModel);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setInferenceProvider);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setInferenceModel);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setPolishEnabled);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setTypingWpm);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setDiagnosticsEnabled);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setHideFromScreenCapture);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setScreenshotContextEnabled);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setDictationPromptEnabled);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.setActivePolishRulePreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.createPolishRulePreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updatePolishRulePreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.deletePolishRulePreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.duplicatePolishRulePreset);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.reorderPolishRulePresets);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.createDictionaryEntry);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateDictionaryEntry);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.deleteDictionaryEntry);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.performPermissionAction);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.refreshPermissions);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.rerunSession);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.deleteSession);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.quit);
  };
}
