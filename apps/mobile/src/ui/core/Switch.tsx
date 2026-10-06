import { Pressable } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withSpring,
} from 'react-native-reanimated';

import { colors } from '../theme';

const TRACK_WIDTH = 52;
const THUMB = 26;
const INSET = 3;

/** An on/off control whose thumb travels with a soft spring and whose track warms to green. */
export function Switch({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label: string;
  disabled?: boolean | undefined;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useDerivedValue(() =>
    reduceMotion ? Number(value) : withSpring(Number(value), { damping: 18, stiffness: 240 }),
  );

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.canvasElevated, colors.accentGreen],
    ),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (TRACK_WIDTH - THUMB - INSET * 2) }],
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.textSecondary, colors.canvas],
    ),
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: disabled === true }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled === true ? 0.45 : 1 }}
    >
      <Animated.View
        style={[
          { width: TRACK_WIDTH, height: THUMB + INSET * 2, borderRadius: 999, padding: INSET },
          track,
        ]}
      >
        <Animated.View style={[{ width: THUMB, height: THUMB, borderRadius: 999 }, thumb]} />
      </Animated.View>
    </Pressable>
  );
}
