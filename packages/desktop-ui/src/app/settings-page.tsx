import { Bot, BrainCircuit, History, Keyboard, Mic, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { type AppState, type DesktopApi, type ProviderId } from '@toph/desktop-contracts';

import { AppBackdrop } from '../components/app-backdrop';
import { Button } from '../components/button';
import { AudioSection } from '../components/settings/audio-section';
import { DiagnosticsSection } from '../components/settings/diagnostics-section';
import { PolishSection } from '../components/settings/polish-section';
import { ProviderSection } from '../components/settings/provider-section';
import { RoutingSection } from '../components/settings/routing-section';
import {
  SettingsSideNav,
  type SettingsSideNavSection,
} from '../components/settings/settings-side-nav';
import { ShortcutSection } from '../components/settings/shortcut-section';
import { useAudioDevices } from '../hooks/use-audio-devices';

const settingsSectionIds = {
  providers: 'providers',
  models: 'models',
  audio: 'audio',
  writing: 'writing',
  shortcuts: 'shortcuts',
  advanced: 'advanced',
} as const;

type SettingsSectionId = (typeof settingsSectionIds)[keyof typeof settingsSectionIds];

const settingsNavSections = [
  { id: settingsSectionIds.providers, label: 'Providers', icon: Bot },
  { id: settingsSectionIds.models, label: 'Models', icon: BrainCircuit },
  { id: settingsSectionIds.audio, label: 'Audio', icon: Mic },
  { id: settingsSectionIds.writing, label: 'Writing', icon: WandSparkles },
  { id: settingsSectionIds.shortcuts, label: 'Shortcuts', icon: Keyboard },
  { id: settingsSectionIds.advanced, label: 'Advanced', icon: History },
] satisfies readonly SettingsSideNavSection<SettingsSectionId>[];

export function SettingsPage({
  state,
  client,
  onBack,
}: {
  state: AppState;
  client: DesktopApi;
  onBack: () => void;
}) {
  const mainRef = useRef<HTMLElement | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [busyPolish, setBusyPolish] = useState(false);
  const [busySettings, setBusySettings] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    settingsNavSections[0].id,
  );
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

  const scrollToSection = (sectionId: SettingsSectionId) => {
    const element = document.getElementById(sectionId);
    if (!element) {
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setActiveSectionId(sectionId);
    element.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  useEffect(() => {
    const root = mainRef.current;
    if (!root) {
      return;
    }

    let animationFrame = 0;
    const updateActiveSection = () => {
      if (animationFrame !== 0) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const targetTop = root.getBoundingClientRect().top + 72;
        let nextSectionId = settingsNavSections[0].id;
        const scrollable = root.scrollHeight > root.clientHeight + 2;
        const nearScrollEnd =
          scrollable && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;

        for (const section of settingsNavSections) {
          const element = document.getElementById(section.id);
          if (!element) {
            continue;
          }

          if (element.getBoundingClientRect().top <= targetTop) {
            nextSectionId = section.id;
          }
        }

        if (nearScrollEnd) {
          nextSectionId = settingsNavSections[settingsNavSections.length - 1].id;
        }

        setActiveSectionId((current) => (current === nextSectionId ? current : nextSectionId));
      });
    };

    updateActiveSection();
    root.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);

    return () => {
      root.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return (
    <main
      ref={mainRef}
      className="relative h-screen overflow-y-auto bg-canvas px-6 pt-8 pb-10 [scrollbar-width:none] max-[640px]:px-5 [&::-webkit-scrollbar]:hidden"
    >
      <AppBackdrop variant="settings" fixed />

      <section className="relative mx-auto grid max-w-245 grid-cols-[13.5rem_minmax(0,1fr)] gap-x-6 gap-y-5 max-[820px]:block">
        <header className="col-span-2 flex items-center gap-4 pt-4 pb-5 max-[820px]:mb-5">
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

        <SettingsSideNav
          sections={settingsNavSections}
          activeSectionId={activeSectionId}
          onSectionSelect={scrollToSection}
        />

        <div className="min-w-0">
          <ProviderSection
            id={settingsSectionIds.providers}
            provider={provider}
            busy={busyProvider !== null}
            onConnect={() => void connectProvider()}
            onRemove={() => void removeProvider()}
          />

          <RoutingSection
            id={settingsSectionIds.models}
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
            id={settingsSectionIds.audio}
            state={audioDevices.state}
            inputPreference={state.settings.audio.inputDevice}
            outputPreference={state.settings.audio.outputDevice}
            disabled={!settingsEditable || busySettings}
            inputTesting={audioDevices.inputTesting}
            inputEnergy={audioDevices.inputEnergy}
            refreshingDevices={audioDevices.refreshing}
            onInputDeviceChange={(device) =>
              void updateSetting(() => client.setAudioInputDevice(device))
            }
            onOutputDeviceChange={(device) =>
              void updateSetting(() => client.setAudioOutputDevice(device))
            }
            onStartInputTest={() => void audioDevices.startInputTest()}
            onStopInputTest={audioDevices.stopInputTest}
            onPlayOutputTest={() => void audioDevices.playOutputTest()}
            onRefreshDevices={() => void audioDevices.refresh()}
          />

          <PolishSection
            id={settingsSectionIds.writing}
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
            id={settingsSectionIds.shortcuts}
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
            id={settingsSectionIds.advanced}
            providerLabel={provider?.label ?? null}
            currentDesktop={state.environment.currentDesktop}
            sessionType={state.environment.sessionType}
            platform={state.environment.platform}
            providerReady={state.providers.ready}
            polishEnabled={state.settings.polish.enabled}
            polishRulePresetId={state.settings.polish.rulePresetId}
            permissionsReady={state.permissions.ready}
            shortcutBackend={state.shortcut.backend}
            shortcutRegistered={state.shortcut.registered}
            shortcutDetail={state.shortcut.detail}
            ruleSwitcherShortcutBackend={state.ruleSwitcherShortcut.backend}
            ruleSwitcherShortcutRegistered={state.ruleSwitcherShortcut.registered}
            ruleSwitcherShortcutDetail={state.ruleSwitcherShortcut.detail}
            pasteHelper={state.pasteSupport.helper}
            pasteDetail={state.pasteSupport.detail}
          />

          <div className="flex justify-end border-t border-white/6 pt-5">
            <Button variant="danger" onClick={() => void client.quit()}>
              Quit Toph
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
