import Animated from 'react-native-reanimated';
import { withUniwind } from 'uniwind';

/** `Animated.View` that honors `className`; a plain `Animated.View` ignores it. */
export const AnimatedView = withUniwind(Animated.View);
