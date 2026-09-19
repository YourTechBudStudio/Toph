import { BrainCircuit, WandSparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  PROVIDER_ROLES,
  type AppSettings,
  type ProviderConnection,
  type ProviderFieldValue,
  type ProviderId,
  type ProviderRole,
} from '@toph/desktop-contracts';

import { ProviderFieldControl } from './provider-field-controls';
import { providerRoleLabel } from './provider-presentation';
import { SettingsIcon, SettingsRow, SettingsSection, SettingsSelect } from './settings-controls';

const roleCopy: Record<ProviderRole, { title: string; description: string; placeholder: string }> =
  {
    transcription: {
      title: providerRoleLabel.transcription,
      description: 'Turns what you say into text.',
      placeholder: 'Select transcription provider',
    },
    inference: {
      title: providerRoleLabel.inference,
      description: 'Cleans up the transcript afterwards.',
      placeholder: 'Select polishing provider',
    },
  };

type RoutingSectionProps = {
  id?: string;
  providers: ProviderConnection[];
  providerSettings: AppSettings['providers'];
  /** A role with no provider yet is `null`: a fresh install prefers nothing. */
  routing: Record<ProviderRole, ProviderId | null>;
  disabled: boolean;
  onProviderChange: (role: ProviderRole, providerId: ProviderId) => void;
  onSettingChange: (
    providerId: ProviderId,
    group: ProviderRole,
    key: string,
    value: ProviderFieldValue,
  ) => void;
};

/**
 * One band per role: who does the job, then that provider's own declared settings (D13). Each band
 * is headed by the role, which is what separates them — the fields inside a band belong to the
 * provider named directly above them.
 *
 * A provider with no working credentials is listed but not choosable; routing work to something
 * that cannot run it only produces a failure later.
 */
export function RoutingSection(props: RoutingSectionProps) {
  return (
    <SettingsSection
      id={props.id}
      eyebrow="Models"
      description="Choose who does each job, then tune that provider's settings."
    >
      {PROVIDER_ROLES.map((role, index) => (
        <div key={role} className={index > 0 ? 'border-t border-white/5' : ''}>
          <div className="px-4 pt-3.5 pb-1">
            <span className="text-[11px] font-bold tracking-widest text-accent-cyan uppercase">
              {roleCopy[role].title}
            </span>
            <p className="m-0 text-xs leading-relaxed text-text-tertiary">
              {roleCopy[role].description}
            </p>
          </div>
          <RoleRows
            role={role}
            providers={props.providers}
            providerSettings={props.providerSettings}
            selectedId={props.routing[role]}
            disabled={props.disabled}
            onProviderChange={props.onProviderChange}
            onSettingChange={props.onSettingChange}
          />
        </div>
      ))}
    </SettingsSection>
  );
}

function RoleRows({
  role,
  providers,
  providerSettings,
  selectedId,
  disabled,
  onProviderChange,
  onSettingChange,
}: {
  role: ProviderRole;
  providers: ProviderConnection[];
  providerSettings: AppSettings['providers'];
  selectedId: ProviderId | null;
  disabled: boolean;
  onProviderChange: RoutingSectionProps['onProviderChange'];
  onSettingChange: RoutingSectionProps['onSettingChange'];
}) {
  const copy = roleCopy[role];
  const candidates = providers.filter((provider) => provider.roles.includes(role));
  const selected = candidates.find((provider) => provider.id === selectedId) ?? null;
  const icon: ReactNode = (
    <SettingsIcon tone={role === 'transcription' ? 'violet' : 'cyan'}>
      {role === 'transcription' ? (
        <BrainCircuit size={17} strokeWidth={1.8} />
      ) : (
        <WandSparkles size={17} strokeWidth={1.8} />
      )}
    </SettingsIcon>
  );

  return (
    <>
      <SettingsRow label="Provider" icon={icon}>
        <SettingsSelect
          items={candidates.map((provider) => ({
            value: provider.id,
            label:
              provider.status === 'connected' ? provider.label : `${provider.label} — not set up`,
            disabled: provider.status !== 'connected' && provider.id !== selectedId,
          }))}
          value={selectedId}
          placeholder={copy.placeholder}
          disabled={disabled}
          onValueChange={(providerId: ProviderId) => onProviderChange(role, providerId)}
        />
      </SettingsRow>

      {selected && selected.status !== 'connected' && (
        <SettingsRow
          label="Not set up"
          description={`${selected.label} has no working credentials, so this will fail. Set it up under Providers.`}
          tone="danger"
        />
      )}

      {selected?.settingsFields[role].map((field) => (
        <ProviderFieldControl
          key={field.key}
          field={field}
          value={providerSettings[selected.id][role][field.key] ?? ''}
          disabled={disabled}
          onChange={(value) => onSettingChange(selected.id, role, field.key, value)}
        />
      ))}
    </>
  );
}
