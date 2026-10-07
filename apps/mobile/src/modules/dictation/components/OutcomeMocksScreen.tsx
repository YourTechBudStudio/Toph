import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  BackBar,
  cn,
  FadeIn,
  OptionList,
  PageTitle,
  Screen,
  SectionLabel,
  StatusPill,
} from '../../../ui';
import { RecentDictations } from '../../history';
import { splitErrorDetail } from '../error-detail';
import { fileOutcomeRow, outcomeMocks } from '../state/outcome-mocks';
import { LiveWaveform } from './LiveWaveform';
import { RecordOrb } from './RecordOrb';

/**
 * TEMPORARY design preview for in-app dictation (Toph #7). Draws the Home status pill and dictation
 * panel the way `DictationPanel` does, then Home's Recent list, for each way a real dictation can
 * end. Nothing records.
 */
export function OutcomeMocksScreen() {
  const [id, setId] = useState(outcomeMocks[0]?.id ?? '');
  const mock = outcomeMocks.find((candidate) => candidate.id === id) ?? outcomeMocks[0];

  useEffect(() => {
    if (mock !== undefined) {
      fileOutcomeRow(mock);
    }
  }, [mock]);

  if (mock === undefined) {
    return null;
  }

  const transcribing = mock.phase === 'transcribing';
  const error = mock.failed ? splitErrorDetail(mock.caption) : null;

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Mock"
          title="Dictation outcomes"
          description="How Home ends a dictation once it is real. Pick a case; Home is drawn below it, and the orb does nothing here."
        />
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-8">
          <SectionLabel>Case</SectionLabel>
          <OptionList
            label="Case"
            onChange={setId}
            options={outcomeMocks.map(({ id: value, title, detail }) => ({ value, title, detail }))}
            value={mock.id}
          />
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <SectionLabel className="mt-10">Home</SectionLabel>
        <View>
          <StatusPill
            label={transcribing ? 'Transcribing' : 'Ready'}
            live={transcribing}
            tone={transcribing ? 'blue' : 'green'}
          />
        </View>
        <View className="mt-6 items-center">
          <RecordOrb onPress={() => undefined} phase={mock.phase} />
          <LiveWaveform active={false} />
          <View className="mt-4 min-h-18.5 items-center">
            <Text className="font-display text-[22px] tracking-[-0.5px] text-text-primary">
              {mock.headline}
            </Text>
            <Text
              className={cn(
                'mt-1 text-center font-body text-[15px]',
                mock.failed ? 'text-accent-red' : 'text-text-tertiary',
              )}
              numberOfLines={mock.failed ? 4 : undefined}
            >
              {error?.summary ?? mock.caption}
            </Text>
          </View>
          {error?.json == null ? null : (
            <View className="mt-4 self-stretch rounded-2xl border border-line bg-black/25 px-4 py-3">
              <Text
                selectable
                className="text-[12px] leading-4.5 text-text-secondary"
                // No monospace token exists yet; the system one is enough for this preview.
                style={{ fontFamily: 'monospace' }}
              >
                {error.json}
              </Text>
            </View>
          )}
        </View>
        <View className="mt-10">
          <RecentDictations />
        </View>
      </FadeIn>
    </Screen>
  );
}
