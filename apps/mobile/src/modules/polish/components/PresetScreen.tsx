import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BackBar, Button, FadeIn, PageTitle, Screen, StatusPill, TextField } from '../../../ui';
import { usePolishStore } from '../state/polish';
import type { RulePreset } from '../state/presets';

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

function PresetEditor({ preset }: { preset: RulePreset }) {
  const active = usePolishStore((state) => state.activePresetId === preset.id);
  const updatePreset = usePolishStore((state) => state.updatePreset);
  const setActivePreset = usePolishStore((state) => state.setActivePreset);
  const [title, setTitle] = useState(preset.title);
  const [description, setDescription] = useState(preset.description);
  const [body, setBody] = useState(preset.body);
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
            disabled={!dirty || title.trim() === ''}
            icon={Check}
            onPress={() => {
              updatePreset(preset.id, { title: title.trim(), description, body });
              router.back();
            }}
            title="Save rules"
            variant="primary"
          />
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
