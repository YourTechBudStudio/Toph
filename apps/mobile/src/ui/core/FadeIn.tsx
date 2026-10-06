import type { ReactNode } from 'react';
import Animated from 'react-native-reanimated';

import { enterFrom } from './motion';

/** Lets the nth block of a screen rise into place after the ones above it. */
export function FadeIn({ index, children }: { index: number; children: ReactNode }) {
  return <Animated.View entering={enterFrom(index)}>{children}</Animated.View>;
}
