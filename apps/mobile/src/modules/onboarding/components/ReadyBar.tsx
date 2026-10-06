import { ArrowRight } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedView, Button, easeOut, gutter } from '../../../ui';

/** Rises from the bottom once every step is done, with the one way forward. */
export function ReadyBar({ onContinue }: { onContinue: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <AnimatedView
      className="absolute right-0 bottom-0 left-0 border-t border-line-strong bg-canvas-subtle"
      entering={SlideInDown.duration(720).easing(easeOut).reduceMotion(ReduceMotion.System)}
      style={{ paddingHorizontal: gutter, paddingTop: 16, paddingBottom: insets.bottom + 16 }}
    >
      <Text className="font-body-bold text-base text-text-primary">Setup complete.</Text>
      <Text className="mt-0.5 font-body text-sm text-text-secondary">
        The tiny dictation empire is operational.
      </Text>
      <View className="mt-4">
        <Button icon={ArrowRight} onPress={onContinue} title="Continue" variant="primary" />
      </View>
    </AnimatedView>
  );
}
