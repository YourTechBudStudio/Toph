import { Text, View } from 'react-native';

import { Card, colors, FadeIn, PageTitle, RowDivider, Screen } from '../../../ui';
import { KeyboardRow } from '../../keyboard';
import { PermissionRow } from '../../permissions';
import { PresetPicker } from '../../polish';
import { ConnectionForm, ConnectionStatusPill } from '../../provider';
import { useReadiness } from '../state/readiness';
import { ReadyBar } from './ReadyBar';
import { StepSection } from './StepSection';

/** Clearance under the last step, so the ready bar never covers it. */
const READY_BAR_CLEARANCE = 170;

const promises = [
  'Bring your own OpenAI key. No new SaaS bill padding.',
  'Auto-punctuation and formatting. Your ramble, but intentional.',
  'The same engine as desktop. Same VAD, same chunking.',
];

/**
 * Everything Toph needs before the first dictation, as on desktop: connect a provider, grant
 * permissions, choose a writing style. Each step unlocks the next. Within permissions, the
 * microphone and the keyboard are required; notifications are optional and never block Continue.
 */
export function OnboardingScreen({ onContinue }: { onContinue: () => void }) {
  const { provider, microphone, keyboard, writingStyle, ready } = useReadiness();

  return (
    <View className="flex-1">
      <Screen>
        <FadeIn index={0}>
          <View className="mt-4">
            <PageTitle
              eyebrow="Setup"
              title="Your thumbs called. They want a break."
              description="Dictate into any app. I turn your rambling into text so you can focus on breaking production, not your thumbs."
            />
          </View>
          <View className="mt-6 gap-3">
            {promises.map((promise) => (
              <View key={promise} className="flex-row items-center gap-3">
                <View
                  className="size-2 rounded-full bg-accent-cyan"
                  style={{ boxShadow: `0px 0px 10px ${colors.accentCyan}` }}
                />
                <Text className="flex-1 font-body text-sm text-text-secondary">{promise}</Text>
              </View>
            ))}
          </View>
        </FadeIn>

        <FadeIn index={1}>
          <View className="mt-10">
            <StepSection complete={provider} number={1} title="Connect OpenAI">
              <Card className="gap-5">
                <ConnectionStatusPill />
                <ConnectionForm />
              </Card>
            </StepSection>

            <StepSection complete={microphone && keyboard} number={2} title="Grant permissions">
              <View style={{ opacity: provider ? 1 : 0.5 }}>
                <View className="overflow-hidden rounded-card border border-line bg-white/3">
                  <PermissionRow disabled={!provider} permission="microphone" />
                  <RowDivider />
                  <KeyboardRow disabled={!provider} />
                  <RowDivider />
                  <PermissionRow disabled={!provider} optional permission="notifications" />
                </View>
                <Text className="mt-3 font-body text-[13px] leading-5 text-text-tertiary">
                  Android warns that a keyboard could read what you type. I only listen to what you
                  say.
                </Text>
              </View>
            </StepSection>

            <StepSection complete={writingStyle} last number={3} title="Choose a writing style">
              <View style={{ opacity: provider && microphone && keyboard ? 1 : 0.5 }}>
                <PresetPicker disabled={!provider || !microphone || !keyboard} editable={false} />
                <Text className="mt-3 font-body text-[13px] leading-5 text-text-tertiary">
                  Change it any time in Settings. No lock-in, unlike that one vendor SDK.
                </Text>
              </View>
            </StepSection>
          </View>
          {ready ? <View style={{ height: READY_BAR_CLEARANCE }} /> : null}
        </FadeIn>
      </Screen>
      {ready ? <ReadyBar onContinue={onContinue} /> : null}
    </View>
  );
}
