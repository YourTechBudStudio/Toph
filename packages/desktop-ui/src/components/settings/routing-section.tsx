import { useEffect, useMemo, useState } from 'react';

import {
  ANTIGRAVITY_INFERENCE_MODELS,
  ANTIGRAVITY_TRANSCRIPTION_MODELS,
  OPENAI_SUB_INFERENCE_MODELS,
  OPENAI_SUB_TRANSCRIPTION_MODELS,
  type ProviderId,
} from '@toph/desktop-contracts';

import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  type SettingsSelectItem,
} from './settings-controls';

const customModelValue = '__custom_model__';

type ModelPickerKind = 'transcription' | 'inference';

function formatModelLabel(model: string) {
  return model
    .replace(/^antigravity-/i, '')
    .replace(/^chatgpt-backend-transcribe$/i, 'ChatGPT backend transcribe')
    .replace(/^gpt-5\.4-mini$/i, 'GPT-5.4 Mini')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPresetModels(providerId: ProviderId, kind: ModelPickerKind) {
  if (providerId === 'antigravity') {
    return kind === 'transcription' ? ANTIGRAVITY_TRANSCRIPTION_MODELS : ANTIGRAVITY_INFERENCE_MODELS;
  }

  return kind === 'transcription' ? OPENAI_SUB_TRANSCRIPTION_MODELS : OPENAI_SUB_INFERENCE_MODELS;
}

function ModelPicker({
  providerId,
  kind,
  model,
  disabled,
  onModelChange,
}: {
  providerId: ProviderId;
  kind: ModelPickerKind;
  model: string;
  disabled: boolean;
  onModelChange: (model: string) => void;
}) {
  const presetModels = useMemo(() => getPresetModels(providerId, kind), [providerId, kind]);
  const presetValues = useMemo(() => new Set<string>(presetModels), [presetModels]);
  const isPreset = presetValues.has(model);
  const [customSelected, setCustomSelected] = useState(!isPreset);
  const [customDraft, setCustomDraft] = useState(model);
  const selectValue = !customSelected && isPreset ? model : customModelValue;

  useEffect(() => {
    setCustomDraft(model);
    setCustomSelected(!presetValues.has(model));
  }, [model, presetValues]);

  const items: SettingsSelectItem<string>[] = [
    ...presetModels.map((preset) => ({
      value: preset,
      label: `${formatModelLabel(preset)} (${preset})`,
    })),
    { value: customModelValue, label: 'Custom model ID' },
  ];

  const commitCustomDraft = () => {
    const nextModel = customDraft.trim();
    if (!nextModel) {
      setCustomDraft(model);
      return;
    }

    if (nextModel !== model) {
      onModelChange(nextModel);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col items-stretch gap-2">
      <div className="flex justify-end">
        <SettingsSelect
          value={selectValue}
          placeholder={`Select ${kind} model`}
          disabled={disabled}
          items={items}
          onValueChange={(nextValue) => {
            if (nextValue === customModelValue) {
              setCustomSelected(true);
              setCustomDraft(model);
              return;
            }

            setCustomSelected(false);
            setCustomDraft(nextValue);
            onModelChange(nextValue);
          }}
        />
      </div>

      <code className="block rounded-lg border border-white/6 bg-white/4 px-3 py-2 text-right font-mono text-[0.75rem] leading-relaxed break-all whitespace-normal text-text-secondary">
        {model}
      </code>

      {customSelected && (
        <textarea
          rows={2}
          value={customDraft}
          disabled={disabled}
          placeholder="Custom model ID"
          className="min-h-18 w-full resize-y rounded-lg border border-white/8 bg-white/4 px-3 py-2 font-mono text-xs leading-relaxed break-all text-text-primary outline-hidden transition-colors duration-150 hover:bg-white/6 focus:border-accent-blue/70 focus:bg-white/6 disabled:opacity-55"
          onChange={(event) => setCustomDraft(event.currentTarget.value)}
          onBlur={commitCustomDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </div>
  );
}

export function RoutingSection({
  transcriptionProviderItems,
  inferenceProviderItems,
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
  transcriptionProviderItems: SettingsSelectItem<ProviderId>[];
  inferenceProviderItems: SettingsSelectItem<ProviderId>[];
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
      eyebrow="Models"
      description="Choose which provider and model Toph uses for transcription and inference."
    >
      <SettingsRow label="Transcription Provider">
        <SettingsSelect
          value={transcriptionProviderId}
          placeholder="Select transcription provider"
          disabled={disabled}
          items={transcriptionProviderItems}
          onValueChange={onTranscriptionProviderChange}
        />
      </SettingsRow>

      <SettingsRow label="Transcription Model" layout="stacked">
        <ModelPicker
          providerId={transcriptionProviderId}
          kind="transcription"
          model={transcriptionModel}
          disabled={disabled}
          onModelChange={onTranscriptionModelChange}
        />
      </SettingsRow>

      <SettingsRow label="Inference Provider">
        <SettingsSelect
          value={inferenceProviderId}
          placeholder="Select inference provider"
          disabled={disabled}
          items={inferenceProviderItems}
          onValueChange={onInferenceProviderChange}
        />
      </SettingsRow>

      <SettingsRow label="Inference Model" layout="stacked">
        <ModelPicker
          providerId={inferenceProviderId}
          kind="inference"
          model={inferenceModel}
          disabled={disabled}
          onModelChange={onInferenceModelChange}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
