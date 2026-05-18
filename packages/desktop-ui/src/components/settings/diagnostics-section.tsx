import { SettingsRow, SettingsSection, SettingsSwitch, StatusBadge } from './settings-controls';

export function DiagnosticsSection({
  enabled,
  disabled,
  busy,
  onEnabledChange,
  providerLabel,
  currentDesktop,
  sessionType,
  platform,
  providerReady,
  polishEnabled,
  polishRulePresetId,
  permissionsReady,
  pasteHelper,
  pasteDetail,
  screenshotContextStatus,
  screenshotContextDetail,
}: {
  enabled: boolean;
  disabled?: boolean;
  busy?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  providerLabel: string | null;
  currentDesktop: string;
  sessionType: string;
  platform: NodeJS.Platform;
  providerReady: boolean;
  polishEnabled: boolean;
  polishRulePresetId: string | null;
  permissionsReady: boolean;
  pasteHelper: string | null;
  pasteDetail: string;
  screenshotContextStatus: string;
  screenshotContextDetail: string;
}) {
  const rows = [
    ['Provider', providerLabel ?? 'None'],
    ['Desktop environment', currentDesktop || 'Unknown'],
    ['Session type', sessionType || 'Unknown'],
    ['Platform', platform],
    ['Provider status', providerReady ? 'Ready' : 'Needs setup'],
    ['Polish status', polishEnabled ? (polishRulePresetId ?? 'Needs setup') : 'Disabled'],
    ['Permission status', permissionsReady ? 'Ready' : 'Needs setup'],
    ['Paste helper', pasteHelper ?? 'None'],
    ['Paste detail', pasteDetail || 'None'],
    ['Screenshot context', screenshotContextStatus],
    ['Screenshot detail', screenshotContextDetail || 'None'],
  ];

  return (
    <SettingsSection
      eyebrow="Advanced"
      description="Verbose troubleshooting details stay hidden unless diagnostics are enabled."
    >
      <SettingsRow
        label="Diagnostics"
        description="Show verbose runtime and screenshot troubleshooting details."
      >
        <StatusBadge active={enabled} activeLabel="On" inactiveLabel="Off" />
        <SettingsSwitch
          checked={enabled}
          disabled={disabled || busy}
          label="Diagnostics"
          onCheckedChange={onEnabledChange}
        />
      </SettingsRow>

      {enabled && (
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-text-primary transition-colors duration-150 hover:bg-white/4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show diagnostics</span>
            <span className="hidden group-open:inline">Hide diagnostics</span>
            <span className="text-text-tertiary transition-transform duration-150 group-open:rotate-90">
              &gt;
            </span>
          </summary>
          <dl className="border-t border-white/5">
            {rows.map(([label, value], index) => (
              <div
                key={label}
                className={`flex min-h-11 items-center justify-between gap-4 px-4 py-2.5 ${
                  index === rows.length - 1 ? '' : 'border-b border-white/5'
                }`}
              >
                <dt className="text-sm text-text-tertiary">{label}</dt>
                <dd className="m-0 text-right text-sm font-semibold text-text-primary">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </SettingsSection>
  );
}
