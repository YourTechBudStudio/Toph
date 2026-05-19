import {
  SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
  type AudioDeviceInfo,
  type AudioDevicePreference,
  type AudioDeviceState,
} from '@toph/desktop-contracts';

import { Button } from '../button';
import {
  SettingsIcon,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  type SettingsSelectItem,
} from './settings-controls';

function selectedDeviceLabel(preference: AudioDevicePreference, devices: AudioDeviceInfo[]) {
  if (preference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID) {
    return null;
  }

  return devices.find((device) => device.id === preference.id)?.label ?? preference.label;
}

function deviceItems(
  kind: 'input' | 'output',
  state: AudioDeviceState,
  preference: AudioDevicePreference,
): SettingsSelectItem<string>[] {
  const devices = kind === 'input' ? state.inputs : state.outputs;
  const resolution = kind === 'input' ? state.input : state.output;
  const defaultLabel = `System Default - ${resolution.resolvedLabel}`;
  const items: SettingsSelectItem<string>[] = [
    {
      value: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
      label: defaultLabel,
    },
    ...devices
      .filter((device) => !device.isDefault)
      .map((device) => ({ value: device.id, label: device.label })),
  ];

  if (
    preference.id !== SYSTEM_DEFAULT_AUDIO_DEVICE_ID &&
    !items.some((item) => item.value === preference.id)
  ) {
    items.push({
      value: preference.id,
      label: `${preference.label ?? `Previously selected ${kind === 'input' ? 'microphone' : 'output'}`} (Unavailable)`,
    });
  }

  return items;
}

function preferenceForValue(value: string, devices: AudioDeviceInfo[]): AudioDevicePreference {
  if (value === SYSTEM_DEFAULT_AUDIO_DEVICE_ID) {
    return { id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID, label: null };
  }

  return {
    id: value,
    label: devices.find((device) => device.id === value)?.label ?? null,
  };
}

function InputMeter({ energy }: { energy: number }) {
  const bars = [0.22, 0.36, 0.54, 0.76, 0.92, 0.7, 0.48, 0.32, 0.58, 0.4];
  return (
    <div className="flex h-7 min-w-42 items-end gap-1 rounded-full border border-accent-cyan/14 bg-accent-cyan/6 px-2 py-1.5">
      {bars.map((weight, index) => (
        <span
          key={index}
          className="w-1.5 rounded-full bg-accent-cyan transition-[height,opacity] duration-100 ease-out"
          style={{
            height: `${Math.max(12, Math.round(energy * weight * 100))}%`,
            opacity: Math.max(0.28, energy + 0.18),
          }}
        />
      ))}
    </div>
  );
}

export function AudioSection({
  state,
  inputPreference,
  outputPreference,
  disabled,
  refreshing,
  inputTesting,
  inputEnergy,
  onRefresh,
  onInputDeviceChange,
  onOutputDeviceChange,
  onStartInputTest,
  onStopInputTest,
  onPlayOutputTest,
}: {
  state: AudioDeviceState;
  inputPreference: AudioDevicePreference;
  outputPreference: AudioDevicePreference;
  disabled?: boolean;
  refreshing?: boolean;
  inputTesting: boolean;
  inputEnergy: number;
  onRefresh: () => void;
  onInputDeviceChange: (device: AudioDevicePreference) => void;
  onOutputDeviceChange: (device: AudioDevicePreference) => void;
  onStartInputTest: () => void;
  onStopInputTest: () => void;
  onPlayOutputTest: () => void;
}) {
  const inputItems = deviceItems('input', state, inputPreference);
  const outputItems = deviceItems('output', state, outputPreference);
  const selectedInputLabel = selectedDeviceLabel(inputPreference, state.inputs);
  const selectedOutputLabel = selectedDeviceLabel(outputPreference, state.outputs);

  return (
    <SettingsSection
      eyebrow="Audio"
      description="Choose where Toph listens and where the tiny confirmation sounds go. System Default follows your OS dynamically."
      footer={
        <div className="flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
          <span>
            Specific devices are remembered. If one disappears, Toph temporarily falls back to the
            system default.
          </span>
          <Button variant="ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh devices'}
          </Button>
        </div>
      }
    >
      <SettingsRow
        label="Input device"
        description={
          state.input.fallbackUsed ? (
            <span className="text-accent-amber">
              {selectedInputLabel ?? 'Selected microphone'} is unavailable. Using System Default -{' '}
              {state.input.resolvedLabel}.
            </span>
          ) : (
            `Currently using ${inputPreference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID ? 'System Default - ' : ''}${state.input.resolvedLabel}`
          )
        }
        icon={
          <SettingsIcon tone="cyan">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
          </SettingsIcon>
        }
        className="max-[760px]:items-start max-[760px]:flex-col"
      >
        <SettingsSelect
          items={inputItems}
          value={inputPreference.id}
          placeholder="Input device"
          disabled={disabled || inputTesting}
          onValueChange={(value) => onInputDeviceChange(preferenceForValue(value, state.inputs))}
        />
        <Button
          variant={inputTesting ? 'secondary' : 'ghost'}
          onClick={inputTesting ? onStopInputTest : onStartInputTest}
          disabled={disabled}
        >
          {inputTesting ? 'Stop test' : 'Start test'}
        </Button>
      </SettingsRow>

      {inputTesting && (
        <SettingsRow label="Input level" description="Actual microphone energy, not decorative lies.">
          <InputMeter energy={inputEnergy} />
        </SettingsRow>
      )}

      <SettingsRow
        label="Output device"
        description={
          state.output.fallbackUsed ? (
            <span className="text-accent-amber">
              {selectedOutputLabel ?? 'Selected output'} is unavailable. Using System Default -{' '}
              {state.output.resolvedLabel}.
            </span>
          ) : (
            `Currently using ${outputPreference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID ? 'System Default - ' : ''}${state.output.resolvedLabel}`
          )
        }
        icon={
          <SettingsIcon tone="violet">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </SettingsIcon>
        }
        className="max-[760px]:items-start max-[760px]:flex-col"
      >
        <SettingsSelect
          items={outputItems}
          value={outputPreference.id}
          placeholder="Output device"
          disabled={disabled}
          onValueChange={(value) => onOutputDeviceChange(preferenceForValue(value, state.outputs))}
        />
        <Button variant="ghost" onClick={onPlayOutputTest} disabled={disabled}>
          Play test sound
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
