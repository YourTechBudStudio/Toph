import { Keyboard, Smartphone } from 'lucide-react-native';
import { Text, View } from 'react-native';

import {
  BackBar,
  Card,
  colors,
  CopyButton,
  FadeIn,
  PageTitle,
  Screen,
  SectionLabel,
} from '../../../ui';
import { countWords, formatClock, formatRelative, wordsPerMinute } from '../format';
import { useDictation, type Dictation } from '../state/history';
import { useNow } from '../state/now';

export function DictationDetailScreen({ id }: { id: string }) {
  const dictation = useDictation(id);

  if (dictation === undefined) {
    return (
      <Screen header={<BackBar />}>
        <PageTitle
          eyebrow="Dictation"
          title="Cache miss."
          description="I can't find this dictation. It may never have existed, which is the most frightening kind of bug."
        />
      </Screen>
    );
  }

  return <DictationDetail dictation={dictation} />;
}

function DictationDetail({ dictation }: { dictation: Dictation }) {
  const now = useNow();
  const final = dictation.polished ?? dictation.raw;
  const pace = wordsPerMinute(dictation.raw, dictation.durationMs);
  const SourceIcon = dictation.source === 'keyboard' ? Keyboard : Smartphone;
  const when = new Date(dictation.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <View className="flex-row items-center gap-2">
          <SourceIcon color={colors.spark} size={14} strokeWidth={2.2} />
          <Text className="font-body-bold text-xs tracking-[1.6px] text-spark uppercase">
            {dictation.source === 'keyboard' ? 'From the keyboard' : 'From the app'}
          </Text>
        </View>
        <Text className="mt-2 font-display text-[32px] leading-9.5 tracking-[-1px] text-text-primary">
          {formatRelative(dictation.createdAt, now)}
        </Text>
        <Text className="mt-1 font-body text-base text-text-secondary">at {when}</Text>
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-7 flex-row gap-3">
          <Stat label="Length" value={formatClock(dictation.durationMs)} />
          <Stat label="Words" value={String(countWords(final))} />
          <Stat
            label="Pace"
            value={pace === null ? '—' : `${String(pace)}`}
            unit={pace === null ? undefined : 'wpm'}
          />
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-9">
          <SectionLabel>Polished</SectionLabel>
          {dictation.polished === null ? (
            <Card>
              <Text className="font-body text-[15px] leading-6 text-text-tertiary">
                Polish was off for this one. What you said is what you got.
              </Text>
            </Card>
          ) : (
            <Card tone="blue">
              <Text selectable className="font-body text-[17px] leading-6.75 text-text-primary">
                {dictation.polished}
              </Text>
              <View className="mt-5 flex-row items-center justify-between">
                <Text className="font-body-semibold text-[13px] text-accent-blue">
                  {dictation.presetTitle} preset
                </Text>
                <CopyButton text={dictation.polished} what="polished text" />
              </View>
            </Card>
          )}
        </View>
      </FadeIn>

      <FadeIn index={3}>
        <View className="mt-7">
          <SectionLabel>Raw transcript</SectionLabel>
          <Card>
            <Text selectable className="font-body text-[15px] leading-6 text-text-secondary">
              {dictation.raw}
            </Text>
            <View className="mt-5 flex-row justify-end">
              <CopyButton text={dictation.raw} what="raw transcript" />
            </View>
          </Card>
        </View>
      </FadeIn>
    </Screen>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string | undefined }) {
  return (
    <View className="flex-1 rounded-tile border border-line bg-white/3 px-4 py-3">
      <Text className="font-display text-xl tracking-[-0.5px] text-text-primary">
        {value}
        {unit === undefined ? null : (
          <Text className="font-body-semibold text-xs text-text-tertiary"> {unit}</Text>
        )}
      </Text>
      <Text className="mt-0.5 font-body-semibold text-[11px] tracking-[1px] text-text-tertiary uppercase">
        {label}
      </Text>
    </View>
  );
}
