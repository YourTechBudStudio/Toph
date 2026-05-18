import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DesktopApi,
  PermissionRequirement,
  PermissionRequirementId,
  PolishRulePresetSummary,
  ProviderId,
  ProviderState,
} from '@toph/desktop-contracts';

import { AppBackdrop } from '../../components/app-backdrop';
import { Button } from '../../components/button';
import { CheckIcon } from '../../components/onboarding/check-icon';
import { isPermissionComplete } from '../../components/onboarding/onboarding-utils';
import { PermissionCard } from '../../components/onboarding/permission-card';
import { ProviderCard } from '../../components/onboarding/provider-card';
import { StepSection } from '../../components/onboarding/step-section';
import { WindowDragRegion } from '../../components/window-drag-region';

export function OnboardingScreen({
  platform,
  providers,
  permissionsReady,
  rulePresets,
  activeRulePresetId,
  requirements,
  client,
  onSetupAction,
  onContinue,
}: {
  platform: NodeJS.Platform;
  providers: ProviderState;
  permissionsReady: boolean;
  rulePresets: PolishRulePresetSummary[];
  activeRulePresetId: string | null;
  requirements: PermissionRequirement[];
  client: DesktopApi;
  onSetupAction: () => void;
  onContinue: () => void;
}) {
  const [busyPermission, setBusyPermission] = useState<PermissionRequirementId | 'refresh' | null>(
    null,
  );
  const [busyProvider, setBusyProvider] = useState<ProviderId | 'manual' | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busyRulePreset, setBusyRulePreset] = useState<string | null>(null);
  const [selectedRulePresetId, setSelectedRulePresetId] = useState<string | null>(
    activeRulePresetId,
  );
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(
    providers.selectedProviderId ?? providers.providers[0]?.id ?? 'openai-sub',
  );
  const [manualInput, setManualInput] = useState('');
  const refreshingRef = useRef(false);
  const completeCount = requirements.filter((requirement) =>
    isPermissionComplete(requirement),
  ).length;
  const providerComplete = providers.ready;
  const permissionsComplete = permissionsReady && completeCount === requirements.length;
  const writingComplete =
    !!selectedRulePresetId && rulePresets.some((preset) => preset.id === selectedRulePresetId);
  const committedWritingComplete =
    !!activeRulePresetId && rulePresets.some((preset) => preset.id === activeRulePresetId);
  const setupComplete = providerComplete && permissionsComplete && committedWritingComplete;

  useEffect(() => {
    setSelectedRulePresetId(activeRulePresetId);
  }, [activeRulePresetId]);

  useEffect(() => {
    if (providers.selectedProviderId) {
      setSelectedProviderId(providers.selectedProviderId);
    }
  }, [providers.selectedProviderId]);

  const performAction = async (permissionId: PermissionRequirementId) => {
    onSetupAction();
    setBusyPermission(permissionId);
    try {
      await client.performPermissionAction(permissionId);
    } finally {
      setBusyPermission(null);
    }
  };

  const applyProviderRouting = async (providerId: ProviderId) => {
    await Promise.all([
      client.setTranscriptionProvider(providerId),
      client.setInferenceProvider(providerId),
    ]);
  };

  const selectProvider = async (providerId: ProviderId) => {
    onSetupAction();
    setSelectedProviderId(providerId);
    setBusyProvider(providerId);
    try {
      await applyProviderRouting(providerId);
    } finally {
      setBusyProvider(null);
    }
  };

  const connectProvider = async () => {
    onSetupAction();
    setBusyProvider(selectedProviderId);
    try {
      await client.connectProvider(selectedProviderId);
      await applyProviderRouting(selectedProviderId);
    } catch {
      // Main process publishes the actionable provider error in AppState.
    } finally {
      setBusyProvider(null);
    }
  };

  const submitManualAuthorization = async () => {
    onSetupAction();
    setBusyProvider('manual');
    try {
      await client.submitProviderAuthorization(selectedProviderId, manualInput);
      await applyProviderRouting(selectedProviderId);
      setManualInput('');
    } catch {
      // Main process publishes the actionable provider error in AppState.
    } finally {
      setBusyProvider(null);
    }
  };

  const selectRulePreset = async (rulePresetId: string) => {
    onSetupAction();
    setSelectedRulePresetId(rulePresetId);
    setBusyRulePreset(rulePresetId);
    try {
      await client.setActivePolishRulePreset(rulePresetId);
    } catch {
      setSelectedRulePresetId(activeRulePresetId);
    } finally {
      setBusyRulePreset(null);
    }
  };

  const refresh = useCallback(async () => {
    if (refreshingRef.current) {
      return;
    }

    refreshingRef.current = true;
    setRefreshFailed(false);
    setBusyPermission('refresh');
    try {
      const results = await Promise.allSettled([
        client.refreshPermissions(),
        client.refreshProviders(),
      ]);
      setRefreshFailed(results.some((result) => result.status === 'rejected'));
    } finally {
      setBusyPermission(null);
      refreshingRef.current = false;
    }
  }, [client]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refresh();
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [refresh]);

  return (
    <main className="relative h-screen overflow-hidden px-10 pt-20 pb-32 max-[980px]:px-6 max-[980px]:pt-14 max-[980px]:pb-36">
      {platform === 'darwin' && <WindowDragRegion />}
      <AppBackdrop variant="onboarding" />

      <section className="relative mx-auto h-full max-w-275">
        <div className="grid h-full min-h-0 gap-16 lg:grid-cols-[1fr_1.4fr] max-[980px]:grid-rows-[auto_1fr] max-[980px]:gap-8">
          <header className="max-w-97.5 self-start max-[980px]:mx-auto max-[980px]:max-w-2xl max-[980px]:text-center">
            <span className="mb-6 inline-flex rounded-full border border-accent-cyan/18 bg-accent-cyan/6 px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.12em] text-accent-cyan uppercase">
              Setup
            </span>
            <h1 className="m-0 font-display text-[2.6rem] leading-[1.05] font-semibold tracking-tighter text-text-primary max-[640px]:text-[2rem]">
              Your fingers called, they want a break.
            </h1>
            <p className="mt-5 mb-0 text-base leading-relaxed text-text-secondary">
              Real-time voice transcription across all your apps. I capture your words so you can
              focus on breaking production, not your wrists.
            </p>
            <div className="mt-8 grid gap-3.5 text-left max-[980px]:mx-auto max-[980px]:max-w-104">
              {[
                'Bring your own subscription - no new SaaS bill padding',
                'Auto-punctuation and formatting. Your ramble, but intentional',
                "Near-instant transcription. I keep up with your voice so your brain doesn't outrun the page.",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-3 text-sm text-text-secondary">
                  <span className="size-2 shrink-0 rounded-full bg-accent-cyan shadow-[0_0_12px_rgba(145,215,227,0.4)]" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </header>

          <div className="min-h-0 overflow-y-auto pr-2 pb-8 [scrollbar-width:none] max-[980px]:pr-0 [&::-webkit-scrollbar]:hidden">
            <div className="pb-8">
              <StepSection
                complete={providerComplete}
                showConnector
                marker={
                  providerComplete ? (
                    <CheckIcon size={16} />
                  ) : (
                    <span className="font-display text-sm font-semibold">1</span>
                  )
                }
                title="Choose a provider"
                status={providerComplete ? 'Complete' : 'Pending'}
              >
                <ProviderCard
                  providers={providers.providers}
                  selectedProviderId={selectedProviderId}
                  busy={busyProvider !== null}
                  manualInput={manualInput}
                  onSelectProvider={(providerId) => void selectProvider(providerId)}
                  onManualInputChange={setManualInput}
                  onConnect={() => void connectProvider()}
                  onSubmitManual={() => void submitManualAuthorization()}
                />
              </StepSection>

              <StepSection
                complete={permissionsComplete}
                showConnector
                marker={
                  permissionsComplete ? (
                    <CheckIcon size={16} />
                  ) : (
                    <span className="font-display text-sm font-semibold">2</span>
                  )
                }
                title="Grant permissions"
                status={permissionsComplete ? 'Complete' : 'Pending'}
              >
                <div className="rounded-[1.375rem] border border-white/6 bg-white/2 px-5 py-4 transition-[transform,border-color,background-color] duration-300 ease-out hover:-translate-y-px hover:border-white/10 hover:bg-white/3">
                  {!permissionsReady && requirements.length === 0 ? (
                    <div className="px-1 py-2">
                      <h3 className="m-0 font-display text-base tracking-[-0.02em] text-text-primary">
                        Inspecting permissions...
                      </h3>
                      <p className="mt-1 mb-0 text-sm text-text-secondary">
                        Rehydrating the macOS permission cache. Classic distributed system: you and
                        System Settings.
                      </p>
                    </div>
                  ) : requirements.length === 0 ? (
                    <div className="px-1 py-2">
                      <h3 className="m-0 font-display text-base tracking-[-0.02em] text-text-primary">
                        No permissions needed
                      </h3>
                      <p className="mt-1 mb-0 text-sm text-text-secondary">
                        Your system already handed over the tiny keys. Suspiciously cooperative.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {requirements.map((requirement) => (
                        <PermissionCard
                          key={requirement.id}
                          requirement={requirement}
                          busy={busyPermission === requirement.id}
                          disabled={!providers.ready}
                          onAction={performAction}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </StepSection>

              <StepSection
                complete={writingComplete}
                marker={
                  writingComplete ? (
                    <CheckIcon size={16} />
                  ) : (
                    <span className="font-display text-sm font-semibold">3</span>
                  )
                }
                title="Choose writing style"
                status={writingComplete ? 'Complete' : 'Required'}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {rulePresets.map((preset) => {
                    const selected = selectedRulePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`group flex min-h-42 cursor-pointer flex-col rounded-[1.375rem] border p-4 text-left transition-[transform,border-color,background-color,opacity] duration-300 ease-out hover:-translate-y-px disabled:cursor-default disabled:opacity-55 ${selected ? 'border-accent-blue/45 bg-accent-blue/10' : 'border-white/6 bg-white/2 hover:border-white/10 hover:bg-white/4'}`}
                        onClick={() => void selectRulePreset(preset.id)}
                        disabled={
                          !providerComplete || !permissionsComplete || busyRulePreset !== null
                        }
                      >
                        <span className="mb-3 inline-flex w-fit rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-text-tertiary uppercase">
                          {selected ? 'Selected' : `Rule ${rulePresets.indexOf(preset) + 1}`}
                        </span>
                        <span className="font-display text-lg font-semibold tracking-[-0.03em] text-text-primary">
                          {preset.title}
                        </span>
                        <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-text-secondary">
                          {preset.description}
                        </span>
                        <span className="mt-auto pt-4 text-xs font-semibold text-accent-blue">
                          {busyRulePreset === preset.id
                            ? 'Selecting...'
                            : selected
                              ? 'Ready to dictate'
                              : 'Use this style'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 mb-0 text-xs leading-relaxed text-text-tertiary">
                  You can change this later from Settings → Writing & Dictionary. No lock-in, unlike
                  that one vendor SDK.
                </p>
              </StepSection>

              <p className="mt-0 mb-0 pl-16 text-sm text-text-tertiary max-[640px]:pl-12">
                Changed something in System Settings?{' '}
                <Button
                  variant="ghost"
                  onClick={() => {
                    onSetupAction();
                    void refresh();
                  }}
                  disabled={busyPermission !== null || busyProvider !== null}
                >
                  {busyPermission === 'refresh' ? 'Checking...' : 'Check again'}
                </Button>
                {refreshFailed && (
                  <span className="block pt-1 text-accent-amber">
                    Refresh could not verify everything. Very rude of the runtime.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {setupComplete && (
        <div className="fixed right-0 bottom-0 left-0 z-40 animate-onboarding-ready-enter border-t border-white/8 bg-canvas/88 px-6 py-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-275 items-center justify-between gap-4 max-[640px]:flex-col max-[640px]:items-stretch">
            <div>
              <p className="m-0 text-sm font-semibold text-text-primary">
                Setup complete. The tiny dictation empire is operational.
              </p>
              <p className="mt-0.5 mb-0 text-xs text-text-tertiary">
                You can change your writing style later from Settings → Writing & Dictionary.
              </p>
            </div>
            <Button variant="primary" className="shrink-0" onClick={onContinue}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
