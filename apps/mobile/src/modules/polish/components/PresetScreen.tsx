import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { PolishRulePreset } from '@toph/dictation-core';

import { BackBar, Button, FadeIn, PageTitle, Screen, StatusPill, TextField } from '../../../ui';
import { usePolishStore } from '../state/polish';
import { ErrorLine } from './ErrorLine';

export function PresetScreen({ id }: { id: string }) {
  const preset = usePolishStore((state) => state.presets.find((candidate) => candidate.id === id));

  if (preset === undefined) {
    return (
      <Screen header={<BackBar />}>
        <PageTitle
          title="404: preset not found"
          description="This preset has left the building. Head back and pick another one."
        />
      </Screen>
    );
  }

  return <PresetEditor key={preset.id} preset={preset} />;
}

function PresetEditor({ preset }: { preset: PolishRulePreset }) {
  const active = usePolishStore((state) => state.activePresetId === preset.id);
  const updatePreset = usePolishStore((state) => state.updatePreset);
  const setActivePreset = usePolishStore((state) => state.setActivePreset);
  const [title, setTitle] = useState(preset.title);
  const [description, setDescription] = useState(preset.description);
  const [body, setBody] = useState(preset.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    title !== preset.title || description !== preset.description || body !== preset.body;

  return (
    <Screen
      header={
        <BackBar
          trailing={active ? <StatusPill label="Active preset" tone="green" /> : undefined}
        />
      }
    >
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Rules"
          title={preset.title}
          description="Plain Markdown, read by the polish model on every dictation. Write it like a good PR description: specific, short, and no surprises."
        />
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-8 gap-5">
          <TextField label="Title" onChangeText={setTitle} value={title} />
          <TextField
            hint="Shown on the preset card."
            label="Description"
            onChangeText={setDescription}
            value={description}
          />
          <TextField label="Rules" multiline onChangeText={setBody} value={body} />
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-8 gap-3">
          <Button
            disabled={saving || !dirty || title.trim() === ''}
            icon={Check}
            onPress={() => {
              setSaving(true);
              setError(null);
              // Core's validator trims, so the fields go in as typed.
              updatePreset(preset.id, { title, description, body }).then(
                () => router.back(),
                (failure: unknown) => {
                  setError(failure instanceof Error ? failure.message : String(failure));
                  setSaving(false);
                },
              );
            }}
            title="Save rules"
            variant="primary"
          />
          {error === null ? null : <ErrorLine message={error} />}
          {active ? null : (
            <Button onPress={() => setActivePreset(preset.id)} title="Use this preset" />
          )}
          {dirty ? (
            <Text className="text-center font-body text-[13px] text-text-tertiary">
              Unsaved changes. Uncommitted, but not forgotten.
            </Text>
          ) : null}
        </View>
      </FadeIn>
    </Screen>
  );
}
