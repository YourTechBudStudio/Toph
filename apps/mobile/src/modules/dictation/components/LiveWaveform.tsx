import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors } from '../../../ui';

const BARS = 31;
const HEIGHT = 44;
const REST = 0.08;
/** Even in silence the bars keep this share of their swing, so a live mic still looks live. */
const FLOOR = 0.12;

/** Taller in the middle, quieter at the edges, so the bars read as a voice and not a meter. */
const envelope = (index: number) => {
  const offset = (index - (BARS - 1) / 2) / ((BARS - 1) / 2);
  return 0.25 + 0.75 * Math.exp(-2.4 * offset * offset);
};

/** Deterministic jitter per bar, so the motion looks organic without changing on every render. */
const jitter = (index: number, salt: number) => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * A field of bars that follows the microphone while listening and settles into a flat line
 * otherwise. `level` (0..1, from `useInputLevel`) sets how tall the bars are; each bar also sways a
 * little on its own, so speech reads as a voice and not a meter.
 */
export function LiveWaveform({ active, level }: { active: boolean; level: SharedValue<number> }) {
  return (
    <View
      accessibilityElementsHidden
      className="flex-row items-center justify-center gap-0.75"
      importantForAccessibility="no-hide-descendants"
      style={{ height: HEIGHT }}
    >
      {Array.from({ length: BARS }, (_, index) => (
        <Bar key={index} active={active} index={index} level={level} />
      ))}
    </View>
  );
}

function Bar({
  active,
  index,
  level,
}: {
  active: boolean;
  index: number;
  level: SharedValue<number>;
}) {
  const reduceMotion = useReducedMotion();
  // This bar's own sway, as a share of its height; the input level scales it.
  const sway = useSharedValue(0);
  const peak = envelope(index);

  useEffect(() => {
    if (!active) {
      cancelAnimation(sway);
      sway.value = withTiming(0, { duration: 500 });
      return;
    }
    if (reduceMotion) {
      cancelAnimation(sway);
      sway.value = 0.8;
      return;
    }
    const high = 0.8 + 0.2 * jitter(index, 1);
    const low = 0.45 + 0.2 * jitter(index, 2);
    const pace = 260 + 260 * jitter(index, 3);
    sway.value = withDelay(
      Math.round(jitter(index, 4) * 300),
      withRepeat(
        withSequence(
          withTiming(high, { duration: pace, easing: Easing.inOut(Easing.quad) }),
          withTiming(low, { duration: pace * 0.8, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(sway);
  }, [active, index, sway, reduceMotion]);

  const style = useAnimatedStyle(() => {
    const loudness = FLOOR + (1 - FLOOR) * level.value;
    return { height: Math.max(4, Math.max(REST, peak * sway.value * loudness) * HEIGHT) };
  });

  return (
    <Animated.View
      style={[
        {
          width: 3,
          borderRadius: 2,
          backgroundColor: active ? colors.accentAmber : colors.textTertiary,
          opacity: active ? 0.45 + peak * 0.55 : 0.5,
        },
        style,
      ]}
    />
  );
}
