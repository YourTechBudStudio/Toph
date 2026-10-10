import { Plus, Trash2 } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DictionaryEntry } from '@toph/dictation-core';

import {
  BackBar,
  Button,
  Card,
  colors,
  FadeIn,
  PageTitle,
  Screen,
  SectionLabel,
  Switch,
  TextField,
} from '../../../ui';
import { usePolishStore } from '../state/polish';
import { ErrorLine } from './ErrorLine';

/** Runs one dictionary action, clearing the last error first and showing this one if it fails. */
type RunAction = (action: () => Promise<void>) => Promise<boolean>;

export function DictionaryScreen() {
  const dictionary = usePolishStore((state) => state.dictionary);
  const addEntry = usePolishStore((state) => state.addEntry);
  const [term, setTerm] = useState('');
  const [hint, setHint] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run: RunAction = async (action) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  };

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Dictionary"
          title="Teach me your words."
          description="Names, acronyms, and product terms. A hint about how they sound helps more than you'd think."
        />
      </FadeIn>

      <FadeIn index={1}>
        <Card className="mt-8 gap-4">
          <TextField label="Term" onChangeText={setTerm} placeholder="Toph" value={term} />
          <TextField
            hint={'Try: sounds like "toff", or "If you hear whisper flow, write Wispr Flow".'}
            label="Hint (optional)"
            onChangeText={setHint}
            placeholder="Proper noun. Sounds like toff."
            value={hint}
          />
          <Button
            disabled={adding || term.trim() === ''}
            icon={Plus}
            onPress={() => {
              // Disabled until the add settles, so a double tap cannot save the term twice.
              setAdding(true);
              void run(() => addEntry(term, hint)).then((added) => {
                setAdding(false);
                if (added) {
                  setTerm('');
                  setHint('');
                }
              });
            }}
            title="Add term"
            variant="primary"
          />
        </Card>
        {error === null ? null : (
          <View className="mt-4">
            <ErrorLine message={error} />
          </View>
        )}
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-9">
          <SectionLabel>{`${String(dictionary.length)} terms`}</SectionLabel>
          {dictionary.length === 0 ? (
            <View className="items-center rounded-card border border-dashed border-line-strong px-6 py-10">
              <Text className="font-display text-base text-text-primary">No words yet.</Text>
              <Text className="mt-1 text-center font-body text-sm text-text-tertiary">
                Suspiciously clean vocabulary. I'll allow it.
              </Text>
            </View>
          ) : (
            <View className="overflow-hidden rounded-card border border-line bg-white/3">
              {dictionary.map((entry, index) => (
                <Fragment key={entry.id}>
                  {index === 0 ? null : <View className="mx-4 h-px bg-line" />}
                  <EntryRow entry={entry} run={run} />
                </Fragment>
              ))}
            </View>
          )}
        </View>
      </FadeIn>
    </Screen>
  );
}

function EntryRow({ entry, run }: { entry: DictionaryEntry; run: RunAction }) {
  const setEntryEnabled = usePolishStore((state) => state.setEntryEnabled);
  const removeEntry = usePolishStore((state) => state.removeEntry);

  return (
    <View className="flex-row items-center gap-3 py-3.5 pr-4 pl-4">
      <View className="flex-1" style={{ opacity: entry.enabled ? 1 : 0.5 }}>
        <Text className="font-body-bold text-base text-text-primary">{entry.term}</Text>
        <Text className="mt-0.5 font-body text-sm leading-5 text-text-tertiary" numberOfLines={2}>
          {entry.hint ?? 'No hint. Living dangerously.'}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Remove ${entry.term}`}
        accessibilityRole="button"
        className="size-9 items-center justify-center rounded-full"
        hitSlop={6}
        onPress={() => void run(() => removeEntry(entry.id))}
      >
        <Trash2 color={colors.textTertiary} size={17} strokeWidth={1.8} />
      </Pressable>
      <Switch
        label={`Use ${entry.term}`}
        onValueChange={(enabled) => void run(() => setEntryEnabled(entry.id, enabled))}
        value={entry.enabled}
      />
    </View>
  );
}
