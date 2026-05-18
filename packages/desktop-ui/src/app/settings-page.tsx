import { useState } from 'react';

import {
  TRANSCRIPTION_PROVIDER_IDS,
  type AppState,
  type DesktopApi,
  type ProviderId,
} from '@toph/desktop-contracts';

import { AppBackdrop } from '../components/app-backdrop';
import { Button } from '../components/button';
import { DiagnosticsSection } from '../components/settings/diagnostics-section';
import { PolishSection } from '../components/settings/polish-section';
import { PrivacySection } from '../components/settings/privacy-section';
import { ProviderSection } from '../components/settings/provider-section';
import { RoutingSection } from '../components/settings/routing-section';
import { ScreenshotContextSection } from '../components/settings/screenshot-context-section';
import { ShortcutSection } from '../components/settings/shortcut-section';
import { WindowDragRegion } from '../components/window-drag-region';

export function SettingsPage({
  state,
  client,
  onBack,
}: {
  state: AppState;
  client: DesktopApi;
  onBack: () => void;
}) {
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null);
  const [busyPolish, setBusyPolish] = useState(false);
  const [busyScreenshotContext, setBusyScreenshotContext] = useState(false);
  const [busyDictationPrompt, setBusyDictationPrompt] = useState(false);
  const [busyPrivacy, setBusyPrivacy] = useState(false);
  const [busyDiagnostics, setBusyDiagnostics] = useState(false);
  const [busySettings, setBusySettings] = useState(false);
  const settingsEditable = state.phase === 'idle';

  const inferenceProviderItems = state.providers.providers.map((item) => ({
    value: item.id,
    label: item.label,
  }));
  const diagnosticsProvider =
    state.providers.providers.find((item) => item.id === state.settings.inference.providerId) ??
    state.providers.providers[0];
  const transcriptionProviderItems = state.providers.providers
    .filter((item) => TRANSCRIPTION_PROVIDER_IDS.includes(item.id))
    .map((item) => ({
      value: item.id,
      label: item.label,
    }));

  const connectProvider = async (providerId: ProviderId) => {
    setBusyProvider(providerId);
    try {
      await client.connectProvider(providerId);
    } catch {
      // Main process publishes provider errors into AppState.
    } finally {
      setBusyProvider(null);
    }
  };

  const removeProvider = async (providerId: ProviderId) => {
    setBusyProvider(providerId);
    try {
      await client.removeProvider(providerId);
    } finally {
      setBusyProvider(null);
    }
  };

  const setPolishEnabled = async (enabled: boolean) => {
    setBusyPolish(true);
    try {
      await client.setPolishEnabled(enabled);
    } finally {
      setBusyPolish(false);
    }
  };

  const setScreenshotContextEnabled = async (enabled: boolean) => {
    setBusyScreenshotContext(true);
    try {
      await client.setScreenshotContextEnabled(enabled);
    } finally {
      setBusyScreenshotContext(false);
    }
  };

  const setDictationPromptEnabled = async (enabled: boolean) => {
    setBusyDictationPrompt(true);
    try {
      await client.setDictationPromptEnabled(enabled);
    } finally {
      setBusyDictationPrompt(false);
    }
  };

  const setDiagnosticsEnabled = async (enabled: boolean) => {
    setBusyDiagnostics(true);
    try {
      await client.setDiagnosticsEnabled(enabled);
    } finally {
      setBusyDiagnostics(false);
    }
  };

  const setHideFromScreenCapture = async (enabled: boolean) => {
    setBusyPrivacy(true);
    try {
      await client.setHideFromScreenCapture(enabled);
    } finally {
      setBusyPrivacy(false);
    }
  };

  const updateSetting = async (action: () => Promise<void>) => {
    setBusySettings(true);
    try {
      await action();
    } finally {
      setBusySettings(false);
    }
  };

  return (
    <main className="relative h-screen overflow-y-auto bg-canvas px-6 pt-8 pb-10 [scrollbar-width:none] max-[640px]:px-5 [&::-webkit-scrollbar]:hidden">
      {state.environment.platform === 'darwin' && <WindowDragRegion />}
      <AppBackdrop variant="settings" fixed />

      <section className="relative mx-auto max-w-160">
        <header className="mb-5 flex items-center gap-4 pt-4 pb-5">
          <button
            type="button"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/8 bg-white/5 text-text-secondary transition-colors duration-200 ease-out hover:bg-white/10 hover:text-text-primary"
            onClick={onBack}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4L6 9L11 14" />
            </svg>
          </button>
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.03em]">Settings</h1>
        </header>

        <ProviderSection
          providers={state.providers.providers}
          busyProvider={busyProvider}
          onConnect={(providerId) => void connectProvider(providerId)}
          onRemove={(providerId) => void removeProvider(providerId)}
        />

        <RoutingSection
          transcriptionProviderItems={transcriptionProviderItems}
          inferenceProviderItems={inferenceProviderItems}
          transcriptionProviderId={state.settings.transcription.providerId}
          transcriptionModel={state.settings.transcription.model}
          inferenceProviderId={state.settings.inference.providerId}
          inferenceModel={state.settings.inference.model}
          disabled={!settingsEditable || busySettings}
          onTranscriptionProviderChange={(providerId: ProviderId) =>
            void updateSetting(() => client.setTranscriptionProvider(providerId))
          }
          onTranscriptionModelChange={(model) =>
            void updateSetting(() => client.setTranscriptionModel(model))
          }
          onInferenceProviderChange={(providerId: ProviderId) =>
            void updateSetting(() => client.setInferenceProvider(providerId))
          }
          onInferenceModelChange={(model) =>
            void updateSetting(() => client.setInferenceModel(model))
          }
        />

        <PolishSection
          enabled={state.settings.polish.enabled}
          activeRulePresetId={state.settings.polish.rulePresetId}
          rulePresets={state.polish.rulePresets}
          dictionary={state.polish.dictionary}
          typingWpm={state.settings.dashboard.typingWpm}
          disabled={!settingsEditable || busyPolish}
          client={client}
          onEnabledChange={(enabled) => void setPolishEnabled(enabled)}
          onTypingWpmChange={(typingWpm) =>
            void updateSetting(() => client.setTypingWpm(typingWpm))
          }
        />

        <ScreenshotContextSection
          screenshots={state.context.screenshots}
          dictationPrompt={state.context.dictationPrompt}
          platform={state.environment.platform}
          disabled={!settingsEditable || busyScreenshotContext}
          busy={busyScreenshotContext}
          dictationPromptBusy={busyDictationPrompt}
          client={client}
          onEnabledChange={(enabled) => void setScreenshotContextEnabled(enabled)}
          onDictationPromptEnabledChange={(enabled) => void setDictationPromptEnabled(enabled)}
        />

        <PrivacySection
          hideFromScreenCapture={state.settings.privacy.hideFromScreenCapture}
          disabled={!settingsEditable || busyPrivacy}
          busy={busyPrivacy}
          onHideFromScreenCaptureChange={(enabled) => void setHideFromScreenCapture(enabled)}
        />

        <ShortcutSection
          shortcut={state.shortcut.chord}
          ruleSwitcherShortcut={state.ruleSwitcherShortcut.chord}
          screenshotContextEnabled={state.settings.context.screenshots.enabled}
          dictationPromptEnabled={state.settings.context.dictationPrompt.enabled}
          platform={state.environment.platform}
          registered={state.shortcut.registered}
          ruleSwitcherRegistered={state.ruleSwitcherShortcut.registered}
          backend={state.shortcut.backend}
          ruleSwitcherBackend={state.ruleSwitcherShortcut.backend}
          detail={state.shortcut.detail}
          ruleSwitcherDetail={state.ruleSwitcherShortcut.detail}
          installed={state.shortcut.installed}
          ruleSwitcherInstalled={state.ruleSwitcherShortcut.installed}
          installable={state.shortcut.installable}
          ruleSwitcherInstallable={state.ruleSwitcherShortcut.installable}
          onRegister={(chord) => client.installShortcut(chord)}
          onRegisterRuleSwitcher={(chord) => client.installRuleSwitcherShortcut(chord)}
          onSuspend={client.suspendShortcut}
          onResume={client.resumeShortcut}
        />

        <DiagnosticsSection
          enabled={state.settings.diagnostics.enabled}
          disabled={!settingsEditable || busyDiagnostics}
          busy={busyDiagnostics}
          onEnabledChange={(enabled) => void setDiagnosticsEnabled(enabled)}
          providerLabel={diagnosticsProvider?.label ?? null}
          currentDesktop={state.environment.currentDesktop}
          sessionType={state.environment.sessionType}
          platform={state.environment.platform}
          providerReady={state.providers.ready}
          polishEnabled={state.settings.polish.enabled}
          polishRulePresetId={state.settings.polish.rulePresetId}
          permissionsReady={state.permissions.ready}
          pasteHelper={state.pasteSupport.helper}
          pasteDetail={state.pasteSupport.detail}
          screenshotContextStatus={state.context.screenshots.status}
          screenshotContextDetail={state.context.screenshots.detail}
        />

        <div className="flex justify-end border-t border-white/6 pt-5">
          <Button variant="danger" onClick={() => void client.quit()}>
            Quit Toph
          </Button>
        </div>
      </section>
    </main>
  );
}
