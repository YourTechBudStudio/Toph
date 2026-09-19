import { useEffect, useRef, useState } from 'react';

import {
  PROVIDER_ROLES,
  type ProviderConnection,
  type ProviderId,
  type ProviderRole,
} from '@toph/desktop-contracts';

import { CheckIcon } from '../../components/onboarding/check-icon';
import { ProviderCard } from '../../components/onboarding/provider-card';
import { StepSection } from '../../components/onboarding/step-section';
import type { ProviderPreviewFixture } from '../provider-fixtures';

/**
 * TEMPORARY (phase 03). Onboarding step 1, rendered inside the real `StepSection` shell with a
 * placeholder step 2 so spacing and the connector line can be judged in context. Deleted in phase
 * 05 with the rest of `preview/`; `ProviderCard` itself is shipping code.
 */
export function OnboardingPreviewTab({ fixture }: { fixture: ProviderPreviewFixture }) {
  const [providers, setProviders] = useState<ProviderConnection[]>(fixture.providers);
  const [routing, setRouting] = useState<Record<ProviderRole, ProviderId | null>>(fixture.routing);
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) {
        clearTimeout(timer);
      }
    };
  }, []);

  const ready = PROVIDER_ROLES.every((role) => {
    const providerId = routing[role];
    return (
      providerId !== null &&
      providers.some((provider) => provider.id === providerId && provider.status === 'connected')
    );
  });

  const patchProvider = (providerId: ProviderId, patch: Partial<ProviderConnection>) =>
    setProviders((current) =>
      current.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    );

  const finishConnect = (providerId: ProviderId, values: Record<string, string>) => {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      return;
    }

    const summary: Record<string, string> = {};
    if (provider.auth.kind === 'form') {
      for (const field of provider.auth.fields) {
        if (field.kind === 'text' && field.secret !== true && values[field.key]) {
          summary[field.key] = values[field.key];
        }
      }
    }

    patchProvider(providerId, {
      status: 'connected',
      error: null,
      accountId: provider.auth.kind === 'oauth' ? 'user@example.com' : null,
      connectionSummary: summary,
    });
    // Main claims every role still unset when a connect succeeds, and never overwrites a choice.
    setRouting((current) => {
      const next = { ...current };
      for (const role of PROVIDER_ROLES) {
        if (next[role] === null && provider.roles.includes(role)) {
          next[role] = providerId;
        }
      }
      return next;
    });
    setBusy(false);
  };

  const connect = (providerId: ProviderId, values: Record<string, string>) => {
    const provider = providers.find((candidate) => candidate.id === providerId);
    patchProvider(providerId, { status: 'connecting', error: null });

    // OAuth parks in `connecting` until the browser — or the pasted code — comes back; a form
    // connect resolves on its own.
    if (provider?.auth.kind === 'oauth') {
      return;
    }

    setBusy(true);
    timers.current.push(setTimeout(() => finishConnect(providerId, values), 700));
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-[1.375rem] border border-white/6 bg-canvas/60 px-6 pt-6 pb-1">
        <StepSection
          complete={ready}
          showConnector
          marker={
            ready ? (
              <CheckIcon size={16} />
            ) : (
              <span className="font-display text-sm font-semibold">1</span>
            )
          }
          title="Choose a provider"
          status={ready ? 'Complete' : 'Pending'}
        >
          <ProviderCard
            providers={providers}
            selectedProviderId={selectedProviderId}
            busy={busy}
            manualInput={manualInput}
            onSelectProvider={setSelectedProviderId}
            onManualInputChange={setManualInput}
            onConnect={connect}
            onSubmitManual={(providerId) => {
              setManualInput('');
              finishConnect(providerId, {});
            }}
          />
        </StepSection>

        <StepSection
          complete={false}
          marker={<span className="font-display text-sm font-semibold">2</span>}
          title="Grant permissions"
          status="Pending"
        >
          <div className="rounded-[1.375rem] border border-white/6 bg-white/2 px-5 py-4 text-sm text-text-tertiary">
            Placeholder, so step 1&apos;s height and the connector line can be judged in context.
          </div>
        </StepSection>
      </div>

      <p className="m-0 text-xs leading-relaxed text-text-tertiary">
        Routing after connect — transcription: {routing.transcription ?? 'unset'} · polishing:{' '}
        {routing.inference ?? 'unset'}. Claimed by main, not by this screen; shown here only so the
        Complete marker can be checked.
      </p>
    </div>
  );
}
