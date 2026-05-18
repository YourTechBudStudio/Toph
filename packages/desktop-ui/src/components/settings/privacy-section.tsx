import { MonitorOff } from 'lucide-react';

import {
  SettingsIcon,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  StatusBadge,
} from './settings-controls';

export function PrivacySection({
  hideFromScreenCapture,
  disabled,
  busy,
  onHideFromScreenCaptureChange,
}: {
  hideFromScreenCapture: boolean;
  disabled?: boolean;
  busy?: boolean;
  onHideFromScreenCaptureChange: (enabled: boolean) => void;
}) {
  return (
    <SettingsSection
      eyebrow="Privacy"
      description="Control whether Toph appears in screenshots and screen recordings when the platform supports it."
    >
      <SettingsRow
        label="Hide Toph in screen recordings"
        description="Keep Toph windows out of screen capture by default."
        icon={
          <SettingsIcon tone="violet">
            <MonitorOff size={17} strokeWidth={1.8} />
          </SettingsIcon>
        }
      >
        <StatusBadge
          active={hideFromScreenCapture}
          activeLabel="Hidden"
          inactiveLabel="Visible"
          inactiveTone="amber"
        />
        <SettingsSwitch
          checked={hideFromScreenCapture}
          disabled={disabled || busy}
          label="Hide Toph in screen recordings"
          onCheckedChange={onHideFromScreenCaptureChange}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
