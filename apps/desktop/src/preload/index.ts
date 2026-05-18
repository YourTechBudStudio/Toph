import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppState,
  DesktopApi,
  DictionaryEntryDraft,
  OverlaySize,
  PermissionRequirementId,
  PolishRulePresetDraft,
  ProviderId,
  ShortcutChord,
  SoundEventKind,
} from '@toph/desktop-contracts';
import { DESKTOP_IPC_CHANNELS } from '@toph/desktop-contracts';

const stateListeners = new Set<(state: AppState) => void>();
let lastKnownState: AppState | null = null;

const handleStateSnapshot = (_event: Electron.IpcRendererEvent, state: AppState) => {
  lastKnownState = state;

  for (const listener of stateListeners) {
    listener(state);
  }
};

const api: DesktopApi = {
  subscribeState(listener) {
    stateListeners.add(listener);

    if (stateListeners.size === 1) {
      ipcRenderer.on(DESKTOP_IPC_CHANNELS.state, handleStateSnapshot);
      void ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.subscribeState);
    } else if (lastKnownState) {
      listener(lastKnownState);
    }

    return () => {
      stateListeners.delete(listener);

      if (stateListeners.size === 0) {
        ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.state, handleStateSnapshot);
      }
    };
  },
  toggleCapture: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.toggleCapture) as Promise<void>,
  cancelCapture: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelCapture) as Promise<void>,
  resizeOverlay: (size: OverlaySize) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resizeOverlay, size) as Promise<void>,
  showSettings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.showSettings) as Promise<void>,
  hideSettings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.hideSettings) as Promise<void>,
  installShortcut: (chord: ShortcutChord) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.installShortcut, chord) as Promise<void>,
  installRuleSwitcherShortcut: (chord: ShortcutChord) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.installRuleSwitcherShortcut, chord) as Promise<void>,
  suspendShortcut: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.suspendShortcut) as Promise<void>,
  resumeShortcut: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resumeShortcut) as Promise<void>,
  openRuleSwitcher: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openRuleSwitcher) as Promise<void>,
  closeRuleSwitcher: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.closeRuleSwitcher) as Promise<void>,
  selectRuleSwitcherPreset: (rulePresetId: string) =>
    ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.selectRuleSwitcherPreset,
      rulePresetId,
    ) as Promise<void>,
  connectProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.connectProvider, providerId) as Promise<void>,
  submitProviderAuthorization: (providerId: ProviderId, input: string) =>
    ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.submitProviderAuthorization,
      providerId,
      input,
    ) as Promise<void>,
  removeProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.removeProvider, providerId) as Promise<void>,
  refreshProviders: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.refreshProviders) as Promise<void>,
  setAuthProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setAuthProvider, providerId) as Promise<void>,
  setTranscriptionProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setTranscriptionProvider, providerId) as Promise<void>,
  setTranscriptionModel: (model: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setTranscriptionModel, model) as Promise<void>,
  setInferenceProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setInferenceProvider, providerId) as Promise<void>,
  setInferenceModel: (model: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setInferenceModel, model) as Promise<void>,
  setPolishEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setPolishEnabled, enabled) as Promise<void>,
  setTypingWpm: (typingWpm: number) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setTypingWpm, typingWpm) as Promise<void>,
  setDiagnosticsEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setDiagnosticsEnabled, enabled) as Promise<void>,
  setHideFromScreenCapture: (enabled: boolean) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setHideFromScreenCapture, enabled) as Promise<void>,
  setScreenshotContextEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setScreenshotContextEnabled, enabled) as Promise<void>,
  setDictationPromptEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setDictationPromptEnabled, enabled) as Promise<void>,
  setActivePolishRulePreset: (rulePresetId: string) =>
    ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.setActivePolishRulePreset,
      rulePresetId,
    ) as Promise<void>,
  createPolishRulePreset: (draft: PolishRulePresetDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createPolishRulePreset, draft) as Promise<void>,
  updatePolishRulePreset: (id: string, draft: PolishRulePresetDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updatePolishRulePreset, id, draft) as Promise<void>,
  deletePolishRulePreset: (id: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.deletePolishRulePreset, id) as Promise<void>,
  duplicatePolishRulePreset: (id: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.duplicatePolishRulePreset, id) as Promise<void>,
  reorderPolishRulePresets: (ids: string[]) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.reorderPolishRulePresets, ids) as Promise<void>,
  createDictionaryEntry: (draft: DictionaryEntryDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createDictionaryEntry, draft) as Promise<void>,
  updateDictionaryEntry: (id: string, draft: DictionaryEntryDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateDictionaryEntry, id, draft) as Promise<void>,
  deleteDictionaryEntry: (id: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.deleteDictionaryEntry, id) as Promise<void>,
  performPermissionAction: (permissionId: PermissionRequirementId) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.performPermissionAction, permissionId) as Promise<void>,
  refreshPermissions: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.refreshPermissions) as Promise<void>,
  rerunSession: (sessionId: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.rerunSession, sessionId) as Promise<void>,
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.deleteSession, sessionId) as Promise<void>,
  quit: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.quit) as Promise<void>,
  onSoundEvent(listener) {
    const subscription = (_event: Electron.IpcRendererEvent, kind: SoundEventKind) => {
      listener(kind);
    };

    ipcRenderer.on(DESKTOP_IPC_CHANNELS.sound, subscription);
    return () => {
      ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.sound, subscription);
    };
  },
};

contextBridge.exposeInMainWorld('toph', api);
