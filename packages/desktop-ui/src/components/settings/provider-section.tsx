import type {
  AppSettings,
  ProviderConnection,
  ProviderFieldValue,
  ProviderId,
} from '@toph/desktop-contracts';

import { ProviderConnectionCard } from './provider-connection-card';
import { SettingsRow, SettingsSection } from './settings-controls';

/**
 * Every provider in the registry, one card each, all peers. Setting one up is opt-in: a provider
 * you are not using is simply unused, so no card asks for attention on its own.
 */
export function ProviderSection({
  id,
  providers,
  providerSettings,
  busyProviderId,
  onConnect,
  onRemove,
  onSettingChange,
}: {
  id?: string;
  providers: ProviderConnection[];
  providerSettings: AppSettings['providers'];
  busyProviderId: ProviderId | null;
  onConnect: (providerId: ProviderId, values: Record<string, string>) => void;
  onRemove: (providerId: ProviderId) => void;
  onSettingChange: (providerId: ProviderId, key: string, value: ProviderFieldValue) => void;
}) {
  const anyConnected = providers.some((provider) => provider.status === 'connected');

  return (
    <SettingsSection
      id={id}
      eyebrow="Providers"
      description={
        anyConnected
          ? 'Set up a provider when you want to use it. Anything you are not using can stay unconfigured.'
          : 'Set up any one of these to start dictating. Toph has no preference between them.'
      }
    >
      {providers.length === 0 && (
        <SettingsRow
          label="No providers available"
          description="Toph could not find a configured provider."
        />
      )}

      {providers.map((provider) => (
        <ProviderConnectionCard
          key={provider.id}
          provider={provider}
          settings={providerSettings[provider.id].provider}
          busy={busyProviderId !== null}
          onConnect={(values) => onConnect(provider.id, values)}
          onRemove={() => onRemove(provider.id)}
          onSettingChange={(key, value) => onSettingChange(provider.id, key, value)}
        />
      ))}
    </SettingsSection>
  );
}
