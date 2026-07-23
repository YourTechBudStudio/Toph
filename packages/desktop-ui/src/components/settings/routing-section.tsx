import { BrainCircuit } from 'lucide-react';

import type { ProviderId } from '@toph/desktop-contracts';

import {
  SettingsIcon,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsTextInput,
  type SettingsSelectItem,
} from './settings-controls';

export function RoutingSection({
  id,
  providerItems,
  transcriptionProviderId,
  transcriptionModel,
  inferenceProviderId,
  inferenceModel,
  disabled,
  onTranscriptionProviderChange,
  onTranscriptionModelChange,
  onInferenceProviderChange,
  onInferenceModelChange,
}: {
  id?: string;
  providerItems: SettingsSelectItem<ProviderId>[];
  transcriptionProviderId: ProviderId;
  transcriptionModel: string;
  inferenceProviderId: ProviderId;
  inferenceModel: string;
  disabled: boolean;
  onTranscriptionProviderChange: (providerId: ProviderId) => void;
  onTranscriptionModelChange: (model: string) => void;
  onInferenceProviderChange: (providerId: ProviderId) => void;
  onInferenceModelChange: (model: string) => void;
}) {
  return (
    <SettingsSection
      id={id}
      eyebrow="Models"
      description="Choose which provider and model Toph uses for transcription and inference."
    >
      <SettingsRow
        label="Transcription Provider"
        icon={
          <SettingsIcon tone="violet">
            <BrainCircuit size={17} strokeWidth={1.8} />
          </SettingsIcon>
        }
      >
        <SettingsSelect
          items={providerItems}
          value={transcriptionProviderId}
          placeholder="Select transcription provider"
          disabled={disabled}
          onValueChange={onTranscriptionProviderChange}
        />
      </SettingsRow>

      <SettingsRow label="Transcription Model">
        <SettingsTextInput
          value={transcriptionModel}
          disabled={disabled}
          onCommit={onTranscriptionModelChange}
        />
      </SettingsRow>

      <SettingsRow label="Inference Provider">
        <SettingsSelect
          items={providerItems}
          value={inferenceProviderId}
          placeholder="Select inference provider"
          disabled={disabled}
          onValueChange={onInferenceProviderChange}
        />
      </SettingsRow>

      <SettingsRow label="Inference Model">
        <SettingsTextInput
          value={inferenceModel}
          disabled={disabled}
          onCommit={onInferenceModelChange}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
