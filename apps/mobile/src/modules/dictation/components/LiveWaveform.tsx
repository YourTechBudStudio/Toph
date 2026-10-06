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
} from 'react-native-reanimated';

import { colors } from '../../../ui';

const BARS = 31;
const HEIGHT = 44;
const REST = 0.08;

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
 * A field of bars that dances while listening and settles into a flat line otherwise. It is
 * decorative: the real one will follow audio levels from the capture module.
 */
export function LiveWaveform({ active }: { active: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      className="flex-row items-center justify-center gap-0.75"
      importantForAccessibility="no-hide-descendants"
      style={{ height: HEIGHT }}
    >
      {Array.from({ length: BARS }, (_, index) => (
        <Bar key={index} active={active} index={index} />
      ))}
    </View>
  );
}

function Bar({ active, index }: { active: boolean; index: number }) {
  const reduceMotion = useReducedMotion();
  const level = useSharedValue(REST);
  const peak = envelope(index);

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(level);
      level.value = withTiming(active ? peak * 0.5 : REST, { duration: 500 });
      return;
    }
    const high = peak * (0.55 + 0.45 * jitter(index, 1));
    const low = peak * (0.15 + 0.25 * jitter(index, 2));
    const pace = 260 + 260 * jitter(index, 3);
    level.value = withDelay(
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
    return () => cancelAnimation(level);
  }, [active, index, level, peak, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    height: Math.max(4, level.value * HEIGHT),
  }));

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
