import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { app, shell } from 'electron';
import type { autoUpdater as electronAutoUpdater } from 'electron-updater';

import {
  DEFAULT_APP_SETTINGS,
  resolveDefaultShortcutChord,
  resolveDefaultRuleSwitcherShortcutChord,
  type DictationSessionStatus,
} from '@toph/desktop-contracts';

import macAppIconPath from '../../../../assets/app-icons/icon-mac.png?asset';
import appIconPath from '../../../../assets/app-icons/icon.png?asset';
import { createProviderAuthService } from './auth/provider-auth-service';
import type { DictionaryEntry, PolishRulePreset } from './db/schema';
import { createDictationController } from './dictation';
import { buildSessionErrorReport, sanitizeErrorMessage } from './history/error-report';
import { createOpenAiSubInferenceProvider } from './inference/providers/openai-sub-inference-provider';
import { registerDesktopIpc } from './ipc';
import { createElectronCaptureAudioRecorder } from './managers/audio-recorder';
import { createClipboardManager } from './managers/clipboard';
import { createPermissionManager } from './managers/permissions';
import { createShortcutManager } from './managers/shortcuts';
import { createWindowManager } from './managers/windows';
import { createSessionOutputService } from './outputs/session-output-service';
import { resolveTophDataPaths } from './paths';
import { defaultPolishRulePresets } from './polish/builtin-rules';
import { createPolishService } from './polish/polish-service';
import { createPricingService } from './pricing/pricing-service';
import { createSessionSegmentationService } from './segmentation/session-segmentation-service';
import { createDefaultStreamingVadRuntime } from './segmentation/streaming-vad-runtime';
import { createAppSettingsStore } from './settings/app-settings-store';
import { seedDefaultDictionaryEntriesIfNeeded } from './settings/default-dictionary-entries';
import {
  ensureDictionaryEnabledLimit,
  normalizeDictionaryEntryDraft,
  normalizeRulePresetDraft,
} from './settings/writing-settings-validation';
import { createDesktopStateStore } from './state';
import { createRecordingSessionStore } from './stores/session-store';
import { createOpenAiSubTranscriptionProvider } from './transcription/providers/openai-sub-transcription-provider';
import { createSessionTranscriptionCoordinator } from './transcription/session-transcription-coordinator';
import { createDesktopTrayController } from './tray';
import { createDesktopUpdateCoordinator } from './updater/update-coordinator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as {
  autoUpdater: typeof electronAutoUpdater;
};
const appName = 'Toph';

const defaultAppSettings = {
  ...DEFAULT_APP_SETTINGS,
  shortcut: {
    chord: resolveDefaultShortcutChord(process.platform),
  },
  ruleSwitcherShortcut: {
    chord: resolveDefaultRuleSwitcherShortcutChord(process.platform),
  },
};

function describeUnexpectedError(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  return `${prefix} ${detail}.`;
}

function toPolishState(rulePresets: PolishRulePreset[], dictionary: DictionaryEntry[]) {
  return {
    rulePresets: rulePresets.map((rulePreset) => ({
      id: rulePreset.id,
      title: rulePreset.title,
      description: rulePreset.description,
      body: rulePreset.body,
      bodyHash: rulePreset.bodyHash,
      sortOrder: rulePreset.sortOrder,
    })),
    dictionary: dictionary.map((entry) => ({
      id: entry.id,
      term: entry.term,
      hint: entry.hint,
      enabled: entry.enabled,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  };
}

export async function bootstrap(options: {
  shouldToggleOnLaunch: boolean;
  shouldOpenRuleSwitcherOnLaunch: boolean;
  toggleCaptureFlag: string;
  ruleSwitcherFlag: string;
}) {
  app.setName(appName);

  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) {
    app.quit();
    return;
  }

  let isQuitting = false;
  let pendingToggle = options.shouldToggleOnLaunch;
  let pendingRuleSwitcher = options.shouldOpenRuleSwitcherOnLaunch;

  const stateStore = createDesktopStateStore({ appVersion: app.getVersion() });
  const windows = createWindowManager({
    appName,
    appIconPath,
    isQuitting: () => isQuitting,
  });
  const permissions = createPermissionManager();
  const clipboard = createClipboardManager();

  await app.whenReady();

  if (process.platform === 'darwin') {
    app.dock?.setIcon(macAppIconPath);
  }

  const updates = createDesktopUpdateCoordinator({
    stateStore,
    updater: autoUpdater,
    openExternal: shell.openExternal,
    canRestartToUpdate: () => stateStore.getState().phase === 'idle',
    prepareToRestart: () => {
      isQuitting = true;
      app.releaseSingleInstanceLock();
    },
  });

  const dataPaths = await resolveTophDataPaths();
  const sessionStore = await createRecordingSessionStore({
    paths: dataPaths,
    migrationsFolder: join(__dirname, '../../drizzle'),
  });
  for (const [index, rulePreset] of defaultPolishRulePresets.entries()) {
    await sessionStore.syncDefaultPolishRulePreset({ ...rulePreset, sortOrder: index });
  }
  const legacyPolishSettings = await sessionStore.getLegacyPolishSettings();
  const settingsStore = await createAppSettingsStore({
    settingsPath: dataPaths.settingsPath,
    listRulePresetIds: async () =>
      (await sessionStore.listPolishRulePresets()).map((rulePreset) => rulePreset.id),
    defaultSettings: legacyPolishSettings
      ? {
          ...defaultAppSettings,
          polish: {
            ...defaultAppSettings.polish,
            enabled: legacyPolishSettings.enabled,
            rulePresetId: legacyPolishSettings.activeRulePresetId,
          },
        }
      : defaultAppSettings,
  });
  await seedDefaultDictionaryEntriesIfNeeded({ settingsStore, sessionStore });
  const pricing = await createPricingService({ modelsDevCachePath: dataPaths.modelsDevCachePath });
  const refreshDashboardStats = async () => {
    stateStore.setDashboardStats(
      await sessionStore.getDashboardStats({
        now: Date.now(),
        rollingWindowDays: 28,
        typingWpm: settingsStore.getSettings().dashboard.typingWpm,
      }),
    );
  };
  const refreshPolishState = async () => {
    stateStore.setPolish(
      toPolishState(
        await sessionStore.listPolishRulePresets(),
        await sessionStore.listDictionaryEntries(),
      ),
    );
  };
  let writingDataQueue: Promise<unknown> = Promise.resolve();
  const updateWritingData = async (operation: () => Promise<void>) => {
    const task = writingDataQueue.then(async () => {
      if (stateStore.getState().phase !== 'idle') {
        throw new Error('Settings cannot be changed while dictation is active.');
      }
      await operation();
      await refreshPolishState();
    });
    writingDataQueue = task.catch(() => {});
    return task;
  };
  const publishSettings = async () => {
    stateStore.setSettings(settingsStore.getSettings());
    await refreshDashboardStats();
    await refreshPolishState();
  };
  const unsubscribeSettings = settingsStore.subscribe(() => {
    void publishSettings();
  });
  stateStore.setSettings(settingsStore.getSettings());
  if (!settingsStore.getSettings().polish.rulePresetId) {
    const firstRulePreset = (await sessionStore.listPolishRulePresets())[0];
    if (firstRulePreset) {
      await settingsStore.setPolishRulePreset(firstRulePreset.id);
      stateStore.setSettings(settingsStore.getSettings());
    }
  }
  await refreshPolishState();
  await refreshDashboardStats();
  const sensitiveErrorReportRoots = [dataPaths.dataDirectory, process.env.HOME ?? ''];
  const refreshRecentSessions = async (detailsBySessionId: Record<string, string> = {}) => {
    stateStore.setRecentSessions(
      (await sessionStore.listRecentRetainedSessions(8)).map((record) => ({
        id: record.session.id,
        status: record.session.status as DictationSessionStatus,
        createdAt: record.session.createdAt,
        errorMessage: record.session.errorMessage
          ? sanitizeErrorMessage(record.session.errorMessage, sensitiveErrorReportRoots)
          : null,
        errorReport: buildSessionErrorReport(record, sensitiveErrorReportRoots),
        canRetry: record.rawAudioAvailable,
        selectedOutput: record.selectedOutput
          ? {
              id: record.selectedOutput.id,
              text: record.selectedOutput.text,
              kind: record.selectedOutput.kind,
              rulePresetId: record.selectedOutput.rulePresetId,
              rulePresetHash: record.selectedOutput.rulePresetHash,
              createdAt: record.selectedOutput.createdAt,
            }
          : null,
        pasteStatus: 'idle',
        pasteDetail: detailsBySessionId[record.session.id] ?? 'Loaded from local history.',
      })),
    );
  };
  await refreshRecentSessions();
  const audioRecorder = createElectronCaptureAudioRecorder();
  const vadRuntime = createDefaultStreamingVadRuntime({
    onStatusChanged: stateStore.setVadRuntimeStatus,
  });
  await vadRuntime.prepare();
  stateStore.setVadRuntimeStatus(vadRuntime.getStatus());
  const segmentation = createSessionSegmentationService({ sessionStore, vadRuntime });
  const outputs = createSessionOutputService({ sessionStore });
  const providerAuth = createProviderAuthService({
    authPath: dataPaths.authPath,
    openExternal: shell.openExternal,
    onStateChanged: stateStore.setProviders,
  });
  stateStore.setProviders(await providerAuth.getState());
  const transcriptionProvider = createOpenAiSubTranscriptionProvider({
    auth: providerAuth,
    pricing,
    settingsStore,
  });
  const inferenceProvider = createOpenAiSubInferenceProvider({
    auth: providerAuth,
    pricing,
    settingsStore,
  });
  const transcription = createSessionTranscriptionCoordinator({
    sessionStore,
    provider: transcriptionProvider,
  });
  const polish = createPolishService({
    settingsStore,
    sessionStore,
    outputs,
    inference: inferenceProvider,
  });

  const refreshPasteSupport = async () => {
    try {
      stateStore.setPasteSupport(await clipboard.describePasteSupport());
    } catch (error) {
      stateStore.setPasteSupport({
        helper: null,
        detail: describeUnexpectedError(
          'Desktop paste capabilities could not be inspected.',
          error,
        ),
      });
    }
  };
  const ensurePermissionsReady = async () => {
    const permissionState = await permissions.inspectRequiredPermissions();
    stateStore.setPermissions(permissionState);
    if (!permissionState.ready) {
      windows.showSettings();
    }
    return permissionState.ready;
  };
  const refreshReadiness = async () => {
    await Promise.all([ensurePermissionsReady(), refreshPasteSupport()]);
  };
  const ensureProvidersReady = async () => {
    const providerState = await providerAuth.getState();
    stateStore.setProviders(providerState);
    if (!providerState.ready) {
      windows.showSettings();
    }
    return providerState.ready;
  };
  const ensureWritingReady = async () => {
    // Setup intentionally requires a chosen writing style even if polish is later disabled;
    // this avoids silent defaults and keeps Settings ready when the user re-enables polish.
    const rulePresetId = settingsStore.getSettings().polish.rulePresetId;
    const ready = !!rulePresetId && !!(await sessionStore.getPolishRulePreset(rulePresetId));
    if (!ready) {
      windows.showSettings();
    }
    return ready;
  };
  const dictation = createDictationController({
    stateStore,
    sessionStore,
    segmentation,
    transcription,
    outputs,
    polish,
    settingsStore,
    audioRecorder,
    clipboard,
    ensurePermissionsReady: async () =>
      (await ensureProvidersReady()) &&
      (await ensurePermissionsReady()) &&
      (await ensureWritingReady()),
    windows,
    onPasteSupportMayHaveChanged: refreshPasteSupport,
    onDashboardStatsChanged: refreshDashboardStats,
    onRecentSessionsChanged: refreshRecentSessions,
  });
  let ruleSwitcherTimer: ReturnType<typeof setTimeout> | null = null;
  let ruleSwitcherSelectionGeneration = 0;
  const ruleSwitcherPendingSelectionMs = 450;
  const ruleSwitcherAcknowledgementMs = 1_100;
  const invalidateRuleSwitcherSelection = () => {
    ruleSwitcherSelectionGeneration += 1;
  };
  const clearRuleSwitcherTimer = () => {
    if (!ruleSwitcherTimer) {
      return;
    }
    clearTimeout(ruleSwitcherTimer);
    ruleSwitcherTimer = null;
  };
  const closeRuleSwitcherAfter = (delayMs: number) => {
    clearRuleSwitcherTimer();
    ruleSwitcherTimer = setTimeout(() => {
      ruleSwitcherTimer = null;
      invalidateRuleSwitcherSelection();
      stateStore.closeRuleSwitcher();
    }, delayMs);
  };
  const openRuleSwitcher = async () => {
    const state = stateStore.getState();
    if (state.phase !== 'idle' || state.ruleSwitcher.mode !== 'idle') {
      return;
    }

    invalidateRuleSwitcherSelection();
    windows.showOverlay();
    if (!settingsStore.getSettings().polish.enabled) {
      stateStore.showRuleSwitcherDisabled();
      closeRuleSwitcherAfter(3_000);
      return;
    }

    stateStore.openRuleSwitcher();
    closeRuleSwitcherAfter(8_000);
  };
  const closeRuleSwitcher = async () => {
    invalidateRuleSwitcherSelection();
    clearRuleSwitcherTimer();
    stateStore.closeRuleSwitcher();
  };
  const handleDictationTrigger = async () => {
    if (stateStore.getState().ruleSwitcher.mode !== 'idle') {
      await closeRuleSwitcher();
      return;
    }

    await dictation.toggleCapture();
  };
  const selectRuleSwitcherPreset = async (rulePresetId: string) => {
    if (stateStore.getState().ruleSwitcher.mode !== 'selecting') {
      return;
    }
    const selectionGeneration = ruleSwitcherSelectionGeneration + 1;
    ruleSwitcherSelectionGeneration = selectionGeneration;
    const selectionIsCurrent = () =>
      ruleSwitcherSelectionGeneration === selectionGeneration &&
      stateStore.getState().ruleSwitcher.mode === 'selecting';

    try {
      const rulePreset = await sessionStore.getPolishRulePreset(rulePresetId);
      if (!selectionIsCurrent()) {
        return;
      }

      if (!rulePreset) {
        throw new Error(`Polish rule preset "${rulePresetId}" is not available.`);
      }

      await settingsStore.setPolishRulePreset(rulePresetId);
      if (!selectionIsCurrent()) {
        return;
      }

      clearRuleSwitcherTimer();
      ruleSwitcherTimer = setTimeout(() => {
        ruleSwitcherTimer = null;
        if (!selectionIsCurrent()) {
          return;
        }

        stateStore.showRuleSwitcherSelected(rulePresetId, `${rulePreset.title} selected`);
        closeRuleSwitcherAfter(ruleSwitcherAcknowledgementMs);
      }, ruleSwitcherPendingSelectionMs);
    } catch (error) {
      if (!selectionIsCurrent()) {
        return;
      }

      await closeRuleSwitcher();
      throw error;
    }
  };
  const shortcuts = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: join(__dirname, '../../../../scripts/toph-desktop.sh'),
      toggleCaptureFlag: options.toggleCaptureFlag,
      ruleSwitcherFlag: options.ruleSwitcherFlag,
    },
    onDictationTrigger: () => {
      void handleDictationTrigger();
    },
    onRuleSwitcherTrigger: () => {
      void openRuleSwitcher();
    },
    persistDictationShortcut: async (chord) => {
      await settingsStore.setShortcut(chord);
    },
    persistRuleSwitcherShortcut: async (chord) => {
      await settingsStore.setRuleSwitcherShortcut(chord);
    },
  });
  const tray = createDesktopTrayController({
    appName,
    getState: stateStore.getState,
    showSettings: windows.showSettings,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  app.on('second-instance', (_event, argv) => {
    if (isQuitting) {
      return;
    }

    if (argv.includes(options.toggleCaptureFlag)) {
      if (!app.isReady()) {
        pendingToggle = true;
        return;
      }

      void handleDictationTrigger();
      return;
    }

    if (argv.includes(options.ruleSwitcherFlag)) {
      if (!app.isReady()) {
        pendingRuleSwitcher = true;
        return;
      }

      void openRuleSwitcher();
      return;
    }

    if (!app.isReady()) {
      return;
    }

    windows.showSettings();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  const unsubscribeState = stateStore.subscribe((state) => {
    windows.sendState(state);
    tray.refresh();
  });
  const unregisterIpc = registerDesktopIpc({
    getState: stateStore.getState,
    toggleCapture: handleDictationTrigger,
    cancelCapture: dictation.cancelCapture,
    resizeOverlay: windows.resizeOverlay,
    showSettings: windows.showSettings,
    hideSettings: windows.hideSettings,
    minimizeSettings: windows.minimizeSettings,
    toggleSettingsMaximized: windows.toggleSettingsMaximized,
    getSettingsBounds: windows.getSettingsBounds,
    moveSettings: windows.moveSettings,
    installShortcut: shortcuts.installDictationShortcut,
    installRuleSwitcherShortcut: shortcuts.installRuleSwitcherShortcut,
    suspendShortcut: shortcuts.suspend,
    resumeShortcut: shortcuts.resume,
    openRuleSwitcher,
    closeRuleSwitcher,
    selectRuleSwitcherPreset,
    connectProvider: async (providerId) => {
      stateStore.setProviders(await providerAuth.getState());
      try {
        stateStore.setProviders(await providerAuth.connectProvider(providerId));
      } finally {
        stateStore.setProviders(await providerAuth.getState());
      }
    },
    submitProviderAuthorization: async (providerId, input) => {
      try {
        stateStore.setProviders(await providerAuth.submitProviderAuthorization(providerId, input));
      } finally {
        stateStore.setProviders(await providerAuth.getState());
      }
    },
    removeProvider: async (providerId) => {
      stateStore.setProviders(await providerAuth.removeProvider(providerId));
    },
    refreshProviders: async () => {
      stateStore.setProviders(await providerAuth.refreshProviders());
    },
    setAuthProvider: async (providerId) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setAuthProvider(providerId);
    },
    setTranscriptionProvider: async (providerId) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setTranscriptionProvider(providerId);
    },
    setTranscriptionModel: async (model) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setTranscriptionModel(model);
    },
    setInferenceProvider: async (providerId) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setInferenceProvider(providerId);
    },
    setInferenceModel: async (model) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setInferenceModel(model);
    },
    setAudioInputDevice: async (device) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setAudioInputDevice(device);
    },
    setAudioOutputDevice: async (device) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setAudioOutputDevice(device);
    },
    setPolishEnabled: async (enabled) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setPolishEnabled(enabled);
    },
    setTypingWpm: async (typingWpm) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await settingsStore.setTypingWpm(typingWpm);
    },
    setActivePolishRulePreset: async (rulePresetId) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        if (!(await sessionStore.getPolishRulePreset(rulePresetId))) {
          throw new Error(`Polish rule preset "${rulePresetId}" is not available.`);
        }
        await settingsStore.setPolishRulePreset(rulePresetId);
      });
    },
    createPolishRulePreset: async (draft) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        await sessionStore.createPolishRulePreset(normalizeRulePresetDraft(draft));
      });
    },
    updatePolishRulePreset: async (id, draft) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        await sessionStore.updatePolishRulePreset(id, normalizeRulePresetDraft(draft));
      });
    },
    deletePolishRulePreset: async (id) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        if (settingsStore.getSettings().polish.rulePresetId === id) {
          throw new Error('Choose another active rule preset before deleting this one.');
        }
        await sessionStore.deletePolishRulePreset(id);
      });
    },
    duplicatePolishRulePreset: async (id) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        await sessionStore.duplicatePolishRulePreset(id);
      });
    },
    reorderPolishRulePresets: async (ids) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        await sessionStore.reorderPolishRulePresets(ids);
      });
    },
    createDictionaryEntry: async (draft) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        const normalized = normalizeDictionaryEntryDraft(draft);
        ensureDictionaryEnabledLimit({
          entries: await sessionStore.listDictionaryEntries(),
          draft: normalized,
        });
        await sessionStore.createDictionaryEntry(normalized);
      });
    },
    updateDictionaryEntry: async (id, draft) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        const normalized = normalizeDictionaryEntryDraft(draft);
        ensureDictionaryEnabledLimit({
          entries: await sessionStore.listDictionaryEntries(),
          draft: normalized,
          existingId: id,
        });
        await sessionStore.updateDictionaryEntry(id, normalized);
      });
    },
    deleteDictionaryEntry: async (id) => {
      if (stateStore.getState().phase !== 'idle')
        throw new Error('Settings cannot be changed while dictation is active.');
      await updateWritingData(async () => {
        await sessionStore.deleteDictionaryEntry(id);
      });
    },
    performPermissionAction: async (permissionId) => {
      stateStore.setPermissions(await permissions.performPermissionAction(permissionId));
      await refreshPasteSupport();
    },
    refreshPermissions: async () => {
      await refreshReadiness();
    },
    rerunSession: async (sessionId) => {
      try {
        await dictation.rerunSession(sessionId);
      } finally {
        await refreshDashboardStats();
        await refreshRecentSessions({ [sessionId]: 'Rerun from retained raw audio.' });
      }
    },
    deleteSession: async (sessionId) => {
      if (stateStore.getState().phase !== 'idle') {
        throw new Error('History cannot be changed while dictation is active.');
      }

      await sessionStore.removeSession(sessionId);
      await refreshDashboardStats();
      await refreshRecentSessions();
    },
    checkForUpdates: updates.checkForUpdates,
    downloadUpdate: updates.downloadUpdate,
    restartToUpdate: updates.restartToUpdate,
    dismissUpdateNotice: async () => {
      updates.dismissUpdateNotice();
    },
    openUpdateReadme: updates.openUpdateReadme,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  await windows.create();
  await ensureProvidersReady();
  await ensurePermissionsReady();
  await ensureWritingReady();
  const stopTrackingOverlayPlacement = windows.trackOverlayPlacement();
  tray.create();
  let quitCleanupComplete = false;

  await shortcuts.registerSavedShortcuts({
    dictation: settingsStore.getSettings().shortcut.chord,
    ruleSwitcher: settingsStore.getSettings().ruleSwitcherShortcut.chord,
  });
  if (
    !stateStore.getState().shortcut.registered ||
    !stateStore.getState().ruleSwitcherShortcut.registered
  ) {
    windows.showSettings();
  }

  await refreshPasteSupport();

  if (pendingToggle) {
    pendingToggle = false;
    void handleDictationTrigger();
  }
  if (pendingRuleSwitcher) {
    pendingRuleSwitcher = false;
    void openRuleSwitcher();
  }

  app.on('activate', windows.showSettings);
  app.on('will-quit', (event) => {
    if (quitCleanupComplete) {
      return;
    }

    event.preventDefault();
    stopTrackingOverlayPlacement();
    unregisterIpc();
    unsubscribeState();
    unsubscribeSettings();
    clearRuleSwitcherTimer();
    updates.dispose();
    shortcuts.unregister();

    void dictation.dispose().finally(async () => {
      await transcription.dispose();
      await vadRuntime.dispose();
      await providerAuth.dispose();
      sessionStore.close();
      quitCleanupComplete = true;
      app.quit();
    });
  });
}
