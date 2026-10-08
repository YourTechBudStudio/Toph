import { Pressable, Text, View } from 'react-native';

import { cn } from '../../../ui';
import { formatClock } from '../../history';
import type { DictationOutcome } from '../engine/transcription';
import { splitErrorDetail } from '../error-detail';
import { useSessionStore } from '../state/session';
import type { DictationPhase } from '../state/session-store';
import { LiveWaveform } from './LiveWaveform';
import { RecordOrb } from './RecordOrb';
import { useElapsed } from './useElapsed';
import { useForegroundKey } from './useForegroundKey';
import { useInputLevel } from './useInputLevel';

/**
 * In-app dictation: the record orb and what it is doing. A finished transcript is not shown here;
 * it is filed as the newest row of Home's Recent list.
 */
export function DictationPanel() {
  const phase = useSessionStore((state) => state.phase);
  const startedAt = useSessionStore((state) => state.startedAt);
  const outcome = useSessionStore((state) => state.outcome);
  const start = useSessionStore((state) => state.start);
  const stop = useSessionStore((state) => state.stop);
  const cancel = useSessionStore((state) => state.cancel);
  const elapsed = useElapsed(startedAt);
  const listening = phase === 'listening';
  const level = useInputLevel(listening);
  const foregroundKey = useForegroundKey();
  const error = outcome?.kind === 'failed' ? splitErrorDetail(outcome.message) : null;

  return (
    <View className="items-center">
      {/*
        Animations that finish while the app is in the background can leave a stale frame on
        screen (after a background stop, the orb kept its "recording" colour). Remounting on
        return redraws both from the current phase.
      */}
      <RecordOrb key={`orb-${foregroundKey}`} onPress={listening ? stop : start} phase={phase} />
      <LiveWaveform key={`wave-${foregroundKey}`} active={listening} level={level} />
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
            {headline(phase, outcome)}
          </Text>
        )}
        <Text
          className={cn(
            'mt-1 text-center font-body text-[15px]',
            error === null ? 'text-text-tertiary' : 'text-accent-red',
          )}
          numberOfLines={error === null ? undefined : 4}
        >
          {error?.summary ?? caption(phase, outcome)}
        </Text>
      </View>
      {error?.json == null ? null : (
        <View className="mt-4 self-stretch rounded-2xl border border-line bg-black/25 px-4 py-3">
          <Text
            selectable
            className="text-[12px] leading-4.5 text-text-secondary"
            // The system monospace font; there is no monospace token.
            style={{ fontFamily: 'monospace' }}
          >
            {error.json}
          </Text>
        </View>
      )}
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
  );
}

function headline(
  phase: Exclude<DictationPhase, 'listening'>,
  outcome: DictationOutcome | null,
): string {
  switch (phase) {
    case 'idle':
      return 'Tap to dictate';
    case 'transcribing':
      return 'Transcribing…';
    case 'done':
      return outcome?.kind === 'no_speech' ? "Didn't catch that." : 'Shipped.';
    case 'failed':
      return "That didn't work.";
  }
}

/** The line under the headline. A failure's message is shown by the panel itself, in red. */
function caption(phase: DictationPhase, outcome: DictationOutcome | null): string {
  switch (phase) {
    case 'idle':
      return "Talk like you would to a teammate. I'll handle the commas.";
    case 'listening':
      return 'Listening. Tap the orb when you are done.';
    case 'transcribing':
      return "Sending what's left of your recording.";
    case 'done':
      return outcome?.kind === 'no_speech'
        ? 'No speech came through. Tap the orb to try again.'
        : 'Tap the orb to go again.';
    case 'failed':
      return outcome?.kind === 'failed' ? outcome.message : '';
  }
}
