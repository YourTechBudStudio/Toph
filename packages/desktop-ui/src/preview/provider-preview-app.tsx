import { Bot, BrainCircuit } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  PROVIDER_ROLES,
  type ProviderConnection,
  type ProviderFieldValue,
  type ProviderId,
  type ProviderRole,
} from '@toph/desktop-contracts';

import { AppBackdrop } from '../components/app-backdrop';
import { ProviderSection } from '../components/settings/provider-section';
import { RoutingSection } from '../components/settings/routing-section';
import { SettingsSideNav } from '../components/settings/settings-side-nav';
import { OnboardingPreviewTab } from './onboarding/onboarding-preview-tab';
import { providerPreviewFixtures, type ProviderPreviewFixture } from './provider-fixtures';

const previewSections = [
  { id: 'providers', label: 'Providers', icon: Bot },
  { id: 'models', label: 'Models', icon: BrainCircuit },
] as const;

type PreviewSectionId = (typeof previewSections)[number]['id'];

const previewTabs = [
  { id: 'settings', label: 'Settings' },
  { id: 'onboarding', label: 'Onboarding' },
] as const;

type PreviewTabId = (typeof previewTabs)[number]['id'];

/**
 * Temporary harness for iterating on the Providers and Models sections without the main process.
 * Deleted in phase 05 along with the `preview` renderer entry.
 */
export function ProviderPreviewApp({ onClose }: { onClose?: () => void }) {
  const [fixture, setFixture] = useState<ProviderPreviewFixture>(providerPreviewFixtures[0]);
  const [tab, setTab] = useState<PreviewTabId>('settings');

  return (
    <main className="relative h-screen overflow-y-auto bg-canvas px-6 pt-8 pb-10 scrollbar-none max-[640px]:px-5 [&::-webkit-scrollbar]:hidden">
      <AppBackdrop variant="settings" fixed />

      <section className="relative mx-auto grid max-w-245 grid-cols-[13.5rem_minmax(0,1fr)] gap-x-6 gap-y-5 max-[820px]:block">
        <header className="col-span-2 pt-4 pb-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.03em]">
                Provider mock
              </h1>
              <div className="flex gap-1 rounded-lg border border-white/8 bg-white/4 p-1">
                {previewTabs.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`cursor-pointer rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
                      candidate.id === tab
                        ? 'bg-accent-blue/16 text-text-primary'
                        : 'text-text-secondary hover:bg-white/6'
                    }`}
                    onClick={() => setTab(candidate.id)}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                className="cursor-pointer rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors duration-150 hover:bg-white/9 hover:text-text-primary"
                onClick={onClose}
              >
                Back to app
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {providerPreviewFixtures.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  candidate.id === fixture.id
                    ? 'border-accent-blue/60 bg-accent-blue/14 text-text-primary'
                    : 'border-white/8 bg-white/4 text-text-secondary hover:bg-white/8'
                }`}
                onClick={() => setFixture(candidate)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <p className="mt-3 mb-0 max-w-160 text-sm leading-relaxed text-text-secondary">
            {fixture.note}
          </p>
        </header>

        {tab === 'onboarding' ? (
          <div className="col-span-2 min-w-0">
            <OnboardingPreviewTab key={fixture.id} fixture={fixture} />
          </div>
        ) : (
          <>
            <SettingsSideNav
              sections={previewSections}
              activeSectionId="providers"
              onSectionSelect={(sectionId: PreviewSectionId) =>
                document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' })
              }
            />

            <div className="min-w-0">
              <PreviewSections key={fixture.id} fixture={fixture} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function PreviewSections({ fixture }: { fixture: ProviderPreviewFixture }) {
  const [providers, setProviders] = useState<ProviderConnection[]>(fixture.providers);
  const [providerSettings, setProviderSettings] = useState(fixture.providerSettings);
  const [routing, setRouting] = useState(fixture.routing);
  const [busyProviderId, setBusyProviderId] = useState<ProviderId | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) {
        clearTimeout(timer);
      }
    };
  }, []);

  const patchProvider = (providerId: ProviderId, patch: Partial<ProviderConnection>) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    );
  };

  // Mock connect: no API call, just the status transition the real flow would produce.
  const connect = (providerId: ProviderId, values: Record<string, string>) => {
    setBusyProviderId(providerId);
    patchProvider(providerId, { status: 'connecting', error: null });

    timers.current.push(
      setTimeout(() => {
        const provider = providers.find((candidate) => candidate.id === providerId);
        const summary: Record<string, string> = {};
        if (provider?.auth.kind === 'form') {
          for (const field of provider.auth.fields) {
            if (field.kind === 'text' && field.secret !== true && values[field.key]) {
              summary[field.key] = values[field.key];
            }
          }
        }
        patchProvider(providerId, {
          status: 'connected',
          error: null,
          accountId: provider?.auth.kind === 'oauth' ? 'user@example.com' : null,
          connectionSummary: summary,
        });
        // First connect wins: a newly connected provider claims the roles nobody has chosen yet,
        // and never overwrites a choice already made.
        setRouting((current) => {
          const next = { ...current };
          for (const role of PROVIDER_ROLES) {
            if (next[role] === null && provider?.roles.includes(role)) {
              next[role] = providerId;
            }
          }
          return next;
        });
        setBusyProviderId(null);
      }, 700),
    );
  };

  return (
    <>
      <ProviderSection
        id="providers"
        providers={providers}
        providerSettings={providerSettings}
        busyProviderId={busyProviderId}
        onConnect={connect}
        onRemove={(providerId) => {
          patchProvider(providerId, {
            status: 'missing',
            error: null,
            accountId: null,
            connectionSummary: {},
          });
          // Removing credentials releases the roles that were pointed at them.
          setRouting((current) => ({
            transcription: current.transcription === providerId ? null : current.transcription,
            inference: current.inference === providerId ? null : current.inference,
          }));
        }}
        onSettingChange={(providerId, key, value) =>
          updateSetting(providerId, 'provider', key, value)
        }
      />

      <RoutingSection
        id="models"
        providers={providers}
        providerSettings={providerSettings}
        routing={routing}
        disabled={false}
        onProviderChange={(role, providerId) =>
          setRouting((current) => ({ ...current, [role]: providerId }))
        }
        onSettingChange={updateSetting}
      />
    </>
  );

  function updateSetting(
    providerId: ProviderId,
    group: ProviderRole | 'provider',
    key: string,
    value: ProviderFieldValue,
  ) {
    setProviderSettings((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        [group]: { ...current[providerId][group], [key]: value },
      },
    }));
  }
}
