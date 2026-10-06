import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { AnimatedView } from './AnimatedView';
import { cn } from './cn';

const INSET = 4;

/** Settles in a quarter second with only a hint of overshoot. */
const THUMB_SPRING = { duration: 250, dampingRatio: 0.85 } as const;

/** A pill of mutually exclusive choices; the highlight slides to the chosen one. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const segment = options.length === 0 ? 0 : (width - INSET * 2) / options.length;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const offset = useSharedValue(0);

  useEffect(() => {
    const target = index * segment;
    offset.value = reduceMotion ? target : withSpring(target, THUMB_SPRING);
  }, [index, offset, reduceMotion, segment]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View>
      <Text className="mb-2 font-body-semibold text-sm text-text-secondary">{label}</Text>
      <View
        accessibilityLabel={label}
        accessibilityRole="radiogroup"
        className="h-12 flex-row rounded-full border border-line-strong bg-black/15"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ padding: INSET }}
      >
        {width === 0 ? null : (
          <AnimatedView
            className="absolute rounded-full bg-spark"
            style={[{ top: INSET, bottom: INSET, left: INSET, width: segment }, thumb]}
          />
        )}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="flex-1 items-center justify-center"
              onPress={() => onChange(option.value)}
            >
              <Text
                className={cn(
                  'font-body-bold text-sm',
                  selected ? 'text-canvas' : 'text-text-secondary',
                )}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
