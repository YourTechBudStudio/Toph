import { Mic, Volume2 } from 'lucide-react';

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
  id,
  state,
  inputPreference,
  outputPreference,
  disabled,
  inputTesting,
  inputEnergy,
  onInputDeviceChange,
  onOutputDeviceChange,
  onStartInputTest,
  onStopInputTest,
  onPlayOutputTest,
}: {
  id?: string;
  state: AudioDeviceState;
  inputPreference: AudioDevicePreference;
  outputPreference: AudioDevicePreference;
  disabled?: boolean;
  inputTesting: boolean;
  inputEnergy: number;
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
      id={id}
      eyebrow="Audio"
      description="Choose where Toph listens and where the tiny confirmation sounds go. System Default follows your OS dynamically."
      footer={
        <span>
          Specific devices are remembered. If one disappears, Toph temporarily falls back to the
          system default.
        </span>
      }
    >
      <SettingsRow
        label="Input device"
        description={
          state.input.fallbackUsed
            ? `Selected microphone: ${selectedInputLabel ?? 'Unavailable device'}`
            : `Currently using ${inputPreference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID ? 'System Default - ' : ''}${state.input.resolvedLabel}`
        }
        icon={
          <SettingsIcon tone="cyan">
            <Mic size={17} strokeWidth={1.9} />
          </SettingsIcon>
        }
        className={`${state.input.fallbackUsed ? 'border-b-0 pb-2' : ''} max-[760px]:items-start max-[760px]:flex-col`}
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

      {state.input.fallbackUsed && (
        <div className="border-b border-white/5 px-4 pb-3">
          <div className="ml-11 flex gap-2 rounded-xl border border-accent-amber/16 bg-accent-amber/8 px-3 py-2 text-xs leading-relaxed text-text-secondary max-[760px]:ml-0">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent-amber shadow-[0_0_0_4px_rgba(245,169,127,0.12)]" />
            <span>
              <span className="font-semibold text-accent-amber">Using default input.</span>{' '}
              {selectedInputLabel ?? 'The selected microphone'} is unavailable, so Toph is listening
              through {state.input.resolvedLabel} for now.
            </span>
          </div>
        </div>
      )}

      {inputTesting && (
        <SettingsRow
          label="Input level"
          description="Actual microphone energy, not decorative lies."
        >
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
            <Volume2 size={18} strokeWidth={1.9} />
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
