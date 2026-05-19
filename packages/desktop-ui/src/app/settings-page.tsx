import { useState } from 'react';

import { type AppState, type DesktopApi, type ProviderId } from '@toph/desktop-contracts';

import { AppBackdrop } from '../components/app-backdrop';
import { Button } from '../components/button';
import { AudioSection } from '../components/settings/audio-section';
import { DiagnosticsSection } from '../components/settings/diagnostics-section';
import { PolishSection } from '../components/settings/polish-section';
import { ProviderSection } from '../components/settings/provider-section';
import { RoutingSection } from '../components/settings/routing-section';
import { ShortcutSection } from '../components/settings/shortcut-section';
import { WindowDragRegion } from '../components/window-drag-region';
import { useAudioDevices } from '../hooks/use-audio-devices';

export function SettingsPage({
  state,
  client,
  onBack,
}: {
  state: AppState;
  client: DesktopApi;
  onBack: () => void;
}) {
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [busyPolish, setBusyPolish] = useState(false);
  const [busySettings, setBusySettings] = useState(false);
  const audioDevices = useAudioDevices(
    state.settings.audio.inputDevice,
    state.settings.audio.outputDevice,
  );
  const provider = state.providers.providers[0];
  const settingsEditable = state.phase === 'idle';

  const providerItems = state.providers.providers.map((item) => ({
    value: item.id,
    label: item.label,
  }));

  const connectProvider = async () => {
    if (!provider) {
      return;
    }

    setBusyProvider(provider.id);
    try {
      await client.connectProvider(provider.id);
    } catch {
      // Main process publishes provider errors into AppState.
    } finally {
      setBusyProvider(null);
    }
  };

  const removeProvider = async () => {
    if (!provider) {
      return;
    }

    setBusyProvider(provider.id);
    try {
      await client.removeProvider(provider.id);
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
          provider={provider}
          busy={busyProvider !== null}
          onConnect={() => void connectProvider()}
          onRemove={() => void removeProvider()}
        />

        <RoutingSection
          providerItems={providerItems}
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

        <AudioSection
          state={audioDevices.state}
          inputPreference={state.settings.audio.inputDevice}
          outputPreference={state.settings.audio.outputDevice}
          disabled={!settingsEditable || busySettings}
          refreshing={audioDevices.refreshing}
          inputTesting={audioDevices.inputTesting}
          inputEnergy={audioDevices.inputEnergy}
          onRefresh={() => void audioDevices.refresh()}
          onInputDeviceChange={(device) =>
            void updateSetting(() => client.setAudioInputDevice(device))
          }
          onOutputDeviceChange={(device) =>
            void updateSetting(() => client.setAudioOutputDevice(device))
          }
          onStartInputTest={() => void audioDevices.startInputTest()}
          onStopInputTest={audioDevices.stopInputTest}
          onPlayOutputTest={() => void audioDevices.playOutputTest()}
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

        <ShortcutSection
          shortcut={state.shortcut.chord}
          ruleSwitcherShortcut={state.ruleSwitcherShortcut.chord}
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
          providerLabel={provider?.label ?? null}
          currentDesktop={state.environment.currentDesktop}
          sessionType={state.environment.sessionType}
          platform={state.environment.platform}
          providerReady={state.providers.ready}
          polishEnabled={state.settings.polish.enabled}
          polishRulePresetId={state.settings.polish.rulePresetId}
          permissionsReady={state.permissions.ready}
          pasteHelper={state.pasteSupport.helper}
          pasteDetail={state.pasteSupport.detail}
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
