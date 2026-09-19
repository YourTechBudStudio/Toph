import type { ProviderConnection, ProviderId } from '@toph/desktop-contracts';

import {
  ProviderKindIcon,
  providerBillingLabel,
  providerRoleLabel,
} from '../provider/provider-presentation';
import { ProviderStatusBadge } from '../provider/provider-status-badge';
import { ProviderConnect } from './provider-connect';

/**
 * Onboarding step 1. Every provider is a peer: the switcher lists them all with nothing
 * preselected, and the chosen one's connection UI opens beneath it inside the same card, so the
 * choice and the work it implies stay a glance apart.
 *
 * Routing is not this card's business. Connecting claims whichever roles are still unset, and the
 * main process does that claiming, so nothing here writes settings or promises where a role lands.
 */
export function ProviderCard({
  providers,
  selectedProviderId,
  busy,
  manualInput,
  onSelectProvider,
  onManualInputChange,
  onConnect,
  onSubmitManual,
}: {
  providers: ProviderConnection[];
  selectedProviderId: ProviderId | null;
  busy: boolean;
  manualInput: string;
  onSelectProvider: (providerId: ProviderId) => void;
  onManualInputChange: (value: string) => void;
  onConnect: (providerId: ProviderId, values: Record<string, string>) => void;
  onSubmitManual: (providerId: ProviderId) => void;
}) {
  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? null;

  return (
    <article className="rounded-[1.375rem] border border-white/6 bg-white/2 px-7 py-6 max-[640px]:px-5">
      <p className="mt-0 mb-4 text-sm leading-relaxed text-text-secondary">
        Pick whichever you already pay for. Toph has no preference between them.
      </p>

      <div className="grid gap-2 rounded-2xl border border-white/8 bg-white/3 p-1.5 md:grid-cols-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${provider.id === selectedProviderId ? 'bg-accent-blue/14 text-text-primary' : 'text-text-secondary hover:bg-white/5'}`}
            aria-pressed={provider.id === selectedProviderId}
            onClick={() => onSelectProvider(provider.id)}
          >
            <span className="shrink-0">
              <ProviderKindIcon provider={provider} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{provider.label}</span>
              <span className="block truncate text-xs text-text-tertiary">
                {providerHint(provider)}
              </span>
            </span>
            <ProviderStatusBadge status={provider.status} />
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4">
          <ProviderConnect
            // Keyed by provider so switching providers starts a fresh draft on the first paint
            // rather than briefly showing the previous provider's credentials in these fields.
            key={selected.id}
            provider={selected}
            busy={busy}
            manualInput={manualInput}
            onManualInputChange={onManualInputChange}
            onConnect={(values) => onConnect(selected.id, values)}
            onSubmitManual={() => onSubmitManual(selected.id)}
          />
        </div>
      )}
    </article>
  );
}

/**
 * The one-line row caption, built from declared data only: how the provider bills, what it is, and
 * which role it covers when it does not cover both. Truncation is what keeps it one line, so a
 * provider whose description is a paragraph cannot change this card's height.
 */
function providerHint(provider: ProviderConnection) {
  const parts = [providerBillingLabel(provider.billingMode), provider.description];
  if (provider.roles.length === 1) {
    parts.push(`${providerRoleLabel[provider.roles[0]]} only`);
  }
  return parts.filter((part) => part.length > 0).join(' · ');
}
