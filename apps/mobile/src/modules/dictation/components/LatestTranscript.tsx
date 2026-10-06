import { router } from 'expo-router';
import { ArrowUpRight } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Card, colors, CopyButton, enterFrom } from '../../../ui';
import type { Dictation } from '../../history';

/** The transcript that just landed, ready to copy, with a way into its details. */
export function LatestTranscript({ dictation }: { dictation: Dictation }) {
  return (
    <Animated.View entering={enterFrom(0)}>
      <Card tone="blue">
        <Text selectable className="font-body text-[17px] leading-6.75 text-text-primary">
          {dictation.polished ?? dictation.raw}
        </Text>
        <View className="mt-5 flex-row items-center justify-between">
          <Pressable
            accessibilityLabel="Open this dictation"
            accessibilityRole="button"
            className="flex-row items-center gap-1"
            hitSlop={10}
            onPress={() =>
              router.push({ pathname: '/dictation/[id]', params: { id: dictation.id } })
            }
          >
            <Text className="font-body-semibold text-[13px] text-text-secondary">
              Raw and details
            </Text>
            <ArrowUpRight color={colors.textSecondary} size={14} strokeWidth={2} />
          </Pressable>
          <CopyButton what="transcript" />
        </View>
      </Card>
    </Animated.View>
  );
}
