import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedView } from './AnimatedView';
import { pressSpring, releaseSpring } from './motion';

export interface PressableScaleProps extends Omit<
  PressableProps,
  'style' | 'children' | 'className'
> {
  children: ReactNode;
  /** Classes for the visible surface, which is what compresses. */
  className?: string | undefined;
  /** Classes for the touch target around it, for layout such as `flex-1`. */
  outerClassName?: string | undefined;
  /** How far the surface compresses while held. Large surfaces want less. */
  pressedScale?: number | undefined;
}

/**
 * The one press interaction in the app: the surface compresses under the finger and springs back.
 * With reduced motion it dims instead, so the press still reads.
 */
export function PressableScale({
  children,
  className,
  outerClassName,
  pressedScale = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const resting = disabled === true ? 0.45 : 1;

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: resting - pressed.value * (reduceMotion ? 0.25 : 0.06),
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * (1 - pressedScale) }],
  }));

  return (
    <Pressable
      {...rest}
      className={outerClassName ?? ''}
      disabled={disabled ?? false}
      onPressIn={(event) => {
        pressed.value = reduceMotion ? withTiming(1, { duration: 80 }) : withSpring(1, pressSpring);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = reduceMotion
          ? withTiming(0, { duration: 160 })
          : withSpring(0, releaseSpring);
        onPressOut?.(event);
      }}
    >
      <AnimatedView className={className ?? ''} style={animatedStyle}>
        {children}
      </AnimatedView>
    </Pressable>
  );
}
