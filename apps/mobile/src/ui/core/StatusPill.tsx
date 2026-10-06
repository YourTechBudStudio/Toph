import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { toneColor, type Tone } from '../theme';
import { cn } from './cn';

const text: Record<Tone, string> = {
  neutral: 'text-text-secondary',
  blue: 'text-accent-blue',
  violet: 'text-accent-violet',
  green: 'text-accent-green',
  amber: 'text-accent-amber',
  red: 'text-accent-red',
  cyan: 'text-accent-cyan',
};

/** A compact status chip. `live` makes the dot breathe, for states that are in progress. */
export function StatusPill({
  label,
  tone,
  live = false,
}: {
  label: string;
  tone: Tone;
  live?: boolean | undefined;
}) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!live || reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(0.35, { duration: 900 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [live, pulse, reduceMotion]);

  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      className="flex-row items-center gap-2 self-start rounded-full border border-line bg-white/4 px-3 py-1.5"
    >
      <Animated.View
        style={[{ width: 7, height: 7, borderRadius: 999, backgroundColor: toneColor[tone] }, dot]}
      />
      <Text className={cn('font-body-semibold text-[13px]', text[tone])}>{label}</Text>
    </View>
  );
}
