import type { ProviderConnectionStatus } from '@toph/desktop-contracts';

import { badgeDotClass, badgeToneClass, type BadgeTone } from '../settings/settings-controls';

const presentationByStatus: Record<ProviderConnectionStatus, { label: string; tone: BadgeTone }> = {
  connected: { label: 'Connected', tone: 'green' },
  connecting: { label: 'Connecting', tone: 'blue' },
  invalid: { label: 'Action needed', tone: 'red' },
  // Providers are peers: an unconfigured one is unused, never behind. Nothing here nags.
  missing: { label: 'Not set up', tone: 'muted' },
};

/** The four-state connection pill. `StatusBadge` only expresses on/off. */
export function ProviderStatusBadge({ status }: { status: ProviderConnectionStatus }) {
  const { label, tone } = presentationByStatus[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badgeToneClass[tone]}`}
    >
      <span
        className={`size-1.5 rounded-full ${badgeDotClass[tone]} ${status === 'connecting' ? 'animate-pulse' : ''}`}
      />
      {label}
    </span>
  );
}
