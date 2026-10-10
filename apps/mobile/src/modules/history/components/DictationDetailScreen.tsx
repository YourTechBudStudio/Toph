import { Text, View } from 'react-native';

import { BackBar, Card, CopyButton, FadeIn, PageTitle, Screen, SectionLabel } from '../../../ui';
import { usePresetTitle } from '../../polish';
import { countWords, formatClock, formatRelative, wordsPerMinute } from '../format';
import { dictationFallbackText, type Dictation } from '../state/dictation-view';
import { useDictation } from '../state/history';
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
  const { raw, durationMs } = dictation;
  const pace = raw === null || durationMs === null ? null : wordsPerMinute(raw, durationMs);
  const when = new Date(dictation.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <Text className="font-display text-[32px] leading-9.5 tracking-[-1px] text-text-primary">
          {formatRelative(dictation.createdAt, now)}
        </Text>
        <Text className="mt-1 font-body text-base text-text-secondary">at {when}</Text>
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-7 flex-row gap-3">
          <Stat label="Length" value={durationMs === null ? '—' : formatClock(durationMs)} />
          <Stat
            label="Words"
            value={String(countWords(dictation.polished ?? dictation.raw ?? ''))}
          />
          <Stat
            label="Pace"
            value={pace === null ? '—' : `${String(pace)}`}
            unit={pace === null ? undefined : 'wpm'}
          />
        </View>
      </FadeIn>

      {dictation.status === 'done' ? null : (
        <FadeIn index={2}>
          <View className="mt-9">
            <StatusCard dictation={dictation} />
          </View>
        </FadeIn>
      )}

      {dictation.status === 'done' ? (
        <FadeIn index={3}>
          <View className="mt-9">
            <SectionLabel>Polished</SectionLabel>
            <PolishedCard polished={dictation.polished} rulePresetId={dictation.rulePresetId} />
          </View>
        </FadeIn>
      ) : null}

      {raw === null ? null : (
        <FadeIn index={4}>
          <View className="mt-7">
            <SectionLabel>Raw transcript</SectionLabel>
            <Card>
              <Text selectable className="font-body text-[15px] leading-6 text-text-secondary">
                {raw}
              </Text>
              <View className="mt-5 flex-row justify-end">
                <CopyButton text={raw} what="raw transcript" />
              </View>
            </Card>
          </View>
        </FadeIn>
      )}
    </Screen>
  );
}

/** Why a dictation has no final text: its error, or that no speech came through. */
function StatusCard({ dictation }: { dictation: Dictation }) {
  const failed = dictation.status === 'failed';
  return (
    <Card>
      <Text
        selectable
        className={
          failed
            ? 'font-body text-[15px] leading-6 text-accent-red'
            : 'font-body text-[15px] leading-6 text-text-tertiary'
        }
      >
        {dictation.errorMessage ?? dictationFallbackText(dictation)}
      </Text>
    </Card>
  );
}

function PolishedCard({
  polished,
  rulePresetId,
}: {
  polished: string | null;
  rulePresetId: string | null;
}) {
  const presetTitle = usePresetTitle(rulePresetId);

  if (polished === null) {
    return (
      <Card>
        <Text className="font-body text-[15px] leading-6 text-text-tertiary">
          Polish was off for this one. What you said is what you got.
        </Text>
      </Card>
    );
  }

  return (
    <Card tone="blue">
      <Text selectable className="font-body text-[17px] leading-6.75 text-text-primary">
        {polished}
      </Text>
      <View className="mt-5 flex-row items-center justify-between">
        <Text className="font-body-semibold text-[13px] text-accent-blue">
          {presetTitle === null ? 'Polished' : `${presetTitle} preset`}
        </Text>
        <CopyButton text={polished} what="polished text" />
      </View>
    </Card>
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
