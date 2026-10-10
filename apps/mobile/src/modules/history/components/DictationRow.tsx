import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { PressableScale } from '../../../ui';
import { formatClock, formatRelative } from '../format';
import { dictationFallbackText, type Dictation } from '../state/dictation-view';

/** One past dictation in a list: its text first, then when, how long, and whether it failed. */
export function DictationRow({ dictation, now }: { dictation: Dictation; now: number }) {
  return (
    <PressableScale
      accessibilityHint="Opens the raw and polished text"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/dictation/[id]', params: { id: dictation.id } })}
      pressedScale={0.985}
      className="px-5 py-4"
    >
      <Text className="font-body text-[15px] leading-5.5 text-text-primary" numberOfLines={2}>
        {dictation.polished ?? dictation.raw ?? dictationFallbackText(dictation)}
      </Text>
      <View className="mt-2.5 flex-row items-center gap-2">
        {dictation.status === 'failed' ? (
          // Without it, a polish failure would look the same as polish being off.
          <Text className="font-body-semibold text-xs text-accent-red">
            {dictation.raw === null ? 'Failed' : 'Not polished'}
          </Text>
        ) : null}
        <Text className="font-body-medium text-xs text-text-tertiary">
          {formatRelative(dictation.createdAt, now)} ·{' '}
          {dictation.durationMs === null ? '—' : formatClock(dictation.durationMs)}
        </Text>
      </View>
    </PressableScale>
  );
}
