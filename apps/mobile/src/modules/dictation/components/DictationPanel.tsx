import { Pressable, Text, View } from 'react-native';

import { formatClock } from '../../history';
import { useSessionStore, type DictationPhase } from '../state/session';
import { LatestTranscript } from './LatestTranscript';
import { LiveWaveform } from './LiveWaveform';
import { RecordOrb } from './RecordOrb';
import { useElapsed } from './useElapsed';

/** In-app dictation: the record orb, what it is doing, and the transcript it produced. */
export function DictationPanel() {
  const phase = useSessionStore((state) => state.phase);
  const startedAt = useSessionStore((state) => state.startedAt);
  const latest = useSessionStore((state) => state.latest);
  const polishingWith = useSessionStore((state) => state.polishingWith);
  const start = useSessionStore((state) => state.start);
  const stop = useSessionStore((state) => state.stop);
  const cancel = useSessionStore((state) => state.cancel);
  const elapsed = useElapsed(startedAt);
  const listening = phase === 'listening';

  return (
    <View>
      <View className="items-center">
        <RecordOrb onPress={listening ? stop : start} phase={phase} />
        <LiveWaveform active={listening} />
        <View className="mt-4 min-h-18.5 items-center">
          {listening ? (
            <Text
              accessibilityLiveRegion="polite"
              className="font-display text-[34px] tracking-[-1px] text-text-primary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatClock(elapsed)}
            </Text>
          ) : (
            <Text
              accessibilityLiveRegion="polite"
              className="font-display text-[22px] tracking-[-0.5px] text-text-primary"
            >
              {headline(phase)}
            </Text>
          )}
          <Text className="mt-1 text-center font-body text-[15px] text-text-tertiary">
            {caption(phase, polishingWith)}
          </Text>
        </View>
        {listening ? (
          <Pressable
            accessibilityLabel="Discard this recording"
            accessibilityRole="button"
            className="mt-1 rounded-full px-4 py-2"
            hitSlop={8}
            onPress={cancel}
          >
            <Text className="font-body-semibold text-sm text-text-secondary">Discard</Text>
          </Pressable>
        ) : null}
      </View>
      {phase === 'done' && latest !== null ? (
        <View className="mt-6">
          <LatestTranscript key={latest.id} dictation={latest} />
        </View>
      ) : null}
    </View>
  );
}

function headline(phase: Exclude<DictationPhase, 'listening'>): string {
  switch (phase) {
    case 'idle':
      return 'Tap to dictate';
    case 'transcribing':
      return 'Transcribing…';
    case 'polishing':
      return 'Polishing…';
    case 'done':
      return 'Shipped.';
  }
}

function caption(phase: DictationPhase, polishingWith: string | null): string {
  switch (phase) {
    case 'idle':
      return "Talk like you would to a teammate. I'll handle the commas.";
    case 'listening':
      return 'Listening. Tap the orb when you are done.';
    case 'transcribing':
      return 'Batches were already uploading while you talked.';
    case 'polishing':
      return `Applying ${polishingWith ?? 'your'} rules. No force-pushes.`;
    case 'done':
      return 'Tap the orb to go again.';
  }
}
