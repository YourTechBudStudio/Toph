// THROWAWAY MOCK (story #8 UI exploration); see `mock-keyboard.ts`.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop, cn } from '../../../ui';
// The mock reaches into dictation's private components on purpose: the point is to judge the
// keyboard with exactly Home's orb and waveform, without changing dictation's public interface.
import { LiveWaveform } from '../../dictation/components/LiveWaveform';
import { RecordOrb } from '../../dictation/components/RecordOrb';
import { useElapsed } from '../../dictation/components/useElapsed';
import { formatClock } from '../../history';
import { MOCK_COPY, orbPhase, type CaptionTone, type MockPhase } from './mock-keyboard';

export type PanelVariant = 'stacked' | 'compact';

/** `RecordOrb`'s stage size (its `STAGE`); the mock scales the whole stage, ripples included. */
const ORB_STAGE = 248;

const captionTone: Record<CaptionTone, string> = {
  muted: 'text-text-tertiary',
  error: 'text-accent-red',
  link: 'text-accent-blue',
};

/**
 * The voice keyboard as it could look if it reused Home's dictation visuals exactly: the record
 * orb (breathing at rest, ripples while listening, orbit while transcribing), the live waveform,
 * and Home's headline-and-caption pair. Two layouts that trade familiarity for height.
 */
export function MockKeyboardPanel({
  variant,
  phase,
  startedAt,
  onOrb,
  onCaption,
}: {
  variant: PanelVariant;
  phase: MockPhase;
  startedAt: number | null;
  onOrb: () => void;
  onCaption: () => void;
}) {
  const insets = useSafeAreaInsets();
  const listening = phase === 'listening';
  const compact = variant === 'compact';

  return (
    <View
      className="overflow-hidden border-t border-line-strong bg-canvas"
      style={{ paddingBottom: insets.bottom + (compact ? 12 : 16) }}
    >
      <Backdrop />
      {compact ? (
        <View className="flex-row items-center gap-3 px-4 pt-3">
          <ScaledOrb onPress={onOrb} phase={phase} scale={0.42} />
          <View className="flex-1">
            <Status align="left" onCaption={onCaption} phase={phase} small startedAt={startedAt} />
            <View className="mt-2 items-start">
              <LiveWaveform active={listening} />
            </View>
          </View>
        </View>
      ) : (
        <View className="items-center px-4 pt-2">
          <ScaledOrb onPress={onOrb} phase={phase} scale={0.6} />
          <LiveWaveform active={listening} />
          <View className="mt-2 min-h-15 items-center">
            <Status align="center" onCaption={onCaption} phase={phase} startedAt={startedAt} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Home's orb at a keyboard's size. Scaling the stage keeps every proportion and animation intact. */
function ScaledOrb({
  phase,
  scale,
  onPress,
}: {
  phase: MockPhase;
  scale: number;
  onPress: () => void;
}) {
  const size = ORB_STAGE * scale;

  return (
    <View className="items-center justify-center" style={{ width: size, height: size }}>
      <View style={{ width: ORB_STAGE, height: ORB_STAGE, transform: [{ scale }] }}>
        <RecordOrb onPress={onPress} phase={orbPhase(phase)} />
      </View>
    </View>
  );
}

function Status({
  phase,
  startedAt,
  align,
  small = false,
  onCaption,
}: {
  phase: MockPhase;
  startedAt: number | null;
  align: 'left' | 'center';
  small?: boolean;
  onCaption: () => void;
}) {
  const copy = MOCK_COPY[phase];
  const elapsed = useElapsed(startedAt);
  const centered = align === 'center';
  const caption = (
    <Text
      className={cn(
        'mt-0.5 font-body',
        small ? 'text-[13px] leading-4.5' : 'text-[15px]',
        centered && 'text-center',
        captionTone[copy.tone],
        copy.tone === 'link' && 'font-body-semibold',
      )}
      numberOfLines={2}
    >
      {copy.caption}
    </Text>
  );

  return (
    <View className={centered ? 'items-center' : 'items-start'}>
      {copy.headline === null ? (
        <Text
          accessibilityLiveRegion="polite"
          className={cn(
            'font-display text-text-primary',
            small ? 'text-[24px] tracking-[-0.6px]' : 'text-[30px] tracking-[-1px]',
          )}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatClock(elapsed)}
        </Text>
      ) : (
        <Text
          accessibilityLiveRegion="polite"
          className={cn(
            'font-display text-text-primary',
            small ? 'text-[18px] tracking-[-0.4px]' : 'text-[22px] tracking-[-0.5px]',
          )}
        >
          {copy.headline}
          {phase === 'starting' ? <AnimatedDots /> : null}
        </Text>
      )}
      {copy.tone === 'link' ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={onCaption}>
          {caption}
        </Pressable>
      ) : (
        caption
      )}
    </View>
  );
}

/**
 * "", ".", "..", "..." every 400 ms (program design §4.4). The unshown dots stay in the layout,
 * transparent, so centred text does not shift as they appear.
 */
function AnimatedDots() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCount((value) => (value + 1) % 4), 400);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <Text>{'.'.repeat(count)}</Text>
      <Text style={{ opacity: 0 }}>{'.'.repeat(3 - count)}</Text>
    </>
  );
}
