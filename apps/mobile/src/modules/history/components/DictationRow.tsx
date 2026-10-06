import { router } from 'expo-router';
import { Keyboard, Smartphone } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { colors, PressableScale } from '../../../ui';
import { formatClock, formatRelative } from '../format';
import type { Dictation } from '../state/history';

/** One past dictation in a list: its text first, then when, how long, and where it came from. */
export function DictationRow({ dictation, now }: { dictation: Dictation; now: number }) {
  const SourceIcon = dictation.source === 'keyboard' ? Keyboard : Smartphone;

  return (
    <PressableScale
      accessibilityHint="Opens the raw and polished text"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/dictation/[id]', params: { id: dictation.id } })}
      pressedScale={0.985}
      className="px-5 py-4"
    >
      <Text className="font-body text-[15px] leading-5.5 text-text-primary" numberOfLines={2}>
        {dictation.polished ?? dictation.raw}
      </Text>
      <View className="mt-2.5 flex-row items-center gap-2">
        <SourceIcon color={colors.textTertiary} size={13} strokeWidth={2} />
        <Text className="font-body-medium text-xs text-text-tertiary">
          {formatRelative(dictation.createdAt, now)} · {formatClock(dictation.durationMs)}
        </Text>
      </View>
    </PressableScale>
  );
}
