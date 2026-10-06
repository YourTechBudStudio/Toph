import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { SegmentedControl, TextField } from '../../../ui';
import {
  DEFAULT_POLISH_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  polishApis,
  useProviderStore,
} from '../state/provider';

/** How transcription uses the provider: just the model, as on desktop. */
export function TranscriptionFields() {
  const transcriptionModel = useProviderStore((state) => state.transcriptionModel);
  const setTranscriptionModel = useProviderStore((state) => state.setTranscriptionModel);

  return (
    <CommittedField
      hint={`Default: ${DEFAULT_TRANSCRIPTION_MODEL}`}
      label="Model"
      normalize={(value) => (value === '' ? DEFAULT_TRANSCRIPTION_MODEL : value)}
      onCommit={setTranscriptionModel}
      placeholder={DEFAULT_TRANSCRIPTION_MODEL}
      saved={transcriptionModel}
    />
  );
}

/** How polish uses the provider: the model, its reasoning effort, and which API to call. */
export function PolishFields() {
  const polishModel = useProviderStore((state) => state.polishModel);
  const setPolishModel = useProviderStore((state) => state.setPolishModel);
  const reasoningEffort = useProviderStore((state) => state.reasoningEffort);
  const setReasoningEffort = useProviderStore((state) => state.setReasoningEffort);
  const polishApi = useProviderStore((state) => state.polishApi);
  const setPolishApi = useProviderStore((state) => state.setPolishApi);

  return (
    <View className="gap-5">
      <CommittedField
        hint={`Default: ${DEFAULT_POLISH_MODEL}`}
        label="Model"
        normalize={(value) => (value === '' ? DEFAULT_POLISH_MODEL : value)}
        onCommit={setPolishModel}
        placeholder={DEFAULT_POLISH_MODEL}
        saved={polishModel}
      />
      <CommittedField
        hint="Leave empty to use the model's default. For example: minimal, low, medium, high."
        label="Reasoning effort"
        normalize={(value) => value}
        onCommit={setReasoningEffort}
        placeholder="Model default"
        saved={reasoningEffort}
      />
      <SegmentedControl
        label="API"
        onChange={setPolishApi}
        options={polishApis}
        value={polishApi}
      />
    </View>
  );
}

/**
 * A stored text setting: typing edits a draft, and leaving the field saves it, as desktop's
 * settings fields do. `normalize` turns the trimmed draft into what is saved, such as a default
 * for an empty field.
 *
 * Leaving the screen can unmount a focused field without a blur, so the field also saves on
 * unmount; otherwise Back would quietly drop the edit.
 */
function CommittedField({
  label,
  hint,
  placeholder,
  saved,
  normalize,
  onCommit,
}: {
  label: string;
  hint: string;
  placeholder: string;
  saved: string;
  normalize: (trimmed: string) => string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(saved);
  // The unmount save runs after the last render's closures are gone, so it reads from here.
  const latest = useRef({ draft, saved, normalize, onCommit });

  useEffect(() => {
    latest.current = { draft, saved, normalize, onCommit };
  });

  useEffect(
    () => () => {
      const {
        draft: current,
        saved: stored,
        normalize: toSaved,
        onCommit: commit,
      } = latest.current;
      const value = toSaved(current.trim());
      if (value !== stored) {
        commit(value);
      }
    },
    [],
  );

  return (
    <TextField
      hint={hint}
      label={label}
      onBlur={() => {
        const value = normalize(draft.trim());
        onCommit(value);
        setDraft(value);
      }}
      onChangeText={setDraft}
      placeholder={placeholder}
      plain
      value={draft}
    />
  );
}
