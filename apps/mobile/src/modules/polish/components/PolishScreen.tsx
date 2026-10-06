import { router } from 'expo-router';
import { BookA, WandSparkles } from 'lucide-react-native';
import { Text, View } from 'react-native';

import {
  BackBar,
  FadeIn,
  ListRow,
  PageTitle,
  RowGroup,
  Screen,
  SectionLabel,
  Switch,
} from '../../../ui';
import { usePolishStore } from '../state/polish';
import { PresetPicker } from './PresetPicker';

export function PolishScreen() {
  const enabled = usePolishStore((state) => state.enabled);
  const setEnabled = usePolishStore((state) => state.setEnabled);
  const dictionary = usePolishStore((state) => state.dictionary);
  const activeTerms = dictionary.filter((entry) => entry.enabled).length;

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Polish"
          title="You, on a good day."
          description="Before text lands anywhere, I tidy it with your preset. Like a linter, but for sentences, and I actually get listened to."
        />
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-8">
          <RowGroup>
            <ListRow
              detail={
                enabled
                  ? 'On. Rough drafts get a code review.'
                  : 'Off. Raw transcript, typos and all.'
              }
              icon={WandSparkles}
              title="Polish dictations"
              tone="green"
              trailing={
                <Switch label="Polish dictations" onValueChange={setEnabled} value={enabled} />
              }
            />
          </RowGroup>
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-9" style={{ opacity: enabled ? 1 : 0.5 }}>
          <SectionLabel>Preset</SectionLabel>
          <PresetPicker editable />
        </View>
      </FadeIn>

      <FadeIn index={3}>
        <View className="mt-9" style={{ opacity: enabled ? 1 : 0.5 }}>
          <SectionLabel>Vocabulary</SectionLabel>
          <RowGroup>
            <ListRow
              detail={`${String(dictionary.length)} terms, ${String(activeTerms)} active`}
              icon={BookA}
              onPress={() => router.push('/settings/dictionary')}
              title="Dictionary"
              tone="cyan"
            />
          </RowGroup>
          <Text className="mt-3 px-1 font-body text-[13px] leading-5 text-text-tertiary">
            Names, acronyms, and product words I should spell right. Used with care, not as a
            find-and-replace gremlin.
          </Text>
        </View>
      </FadeIn>
    </Screen>
  );
}
