import { router } from 'expo-router';
import { Check, PencilLine } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { cn, colors, PressableScale } from '../../../ui';
import type { RulePreset } from '../state/presets';

/** One rule preset as a choosable card, with a way into its rules. */
export function PresetCard({
  preset,
  index,
  active,
  editable,
  disabled,
  onChoose,
}: {
  preset: RulePreset;
  index: number;
  active: boolean;
  editable: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={`${preset.title} preset`}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onChoose}
      pressedScale={0.98}
      className={cn(
        'rounded-card border p-5',
        active ? 'border-spark/45 bg-spark/10' : 'border-line bg-white/3',
      )}
    >
      <View className="flex-row items-start gap-4">
        <Text
          className={cn(
            'font-display-bold text-[28px] leading-8',
            active ? 'text-spark' : 'text-text-tertiary/60',
          )}
        >
          {String(index + 1).padStart(2, '0')}
        </Text>
        <View className="flex-1">
          <Text className="font-display text-lg text-text-primary">{preset.title}</Text>
          <Text className="mt-1 font-body text-sm leading-5 text-text-secondary">
            {preset.description}
          </Text>
        </View>
        <View
          className={cn(
            'size-6 items-center justify-center rounded-full border',
            active ? 'border-spark bg-spark' : 'border-line-strong',
          )}
        >
          {active ? <Check color={colors.canvas} size={14} strokeWidth={3} /> : null}
        </View>
      </View>
      {editable ? (
        <View className="mt-4 flex-row items-center justify-between border-t border-line pt-3.5">
          <Text className="flex-1 font-body text-[13px] text-text-tertiary" numberOfLines={1}>
            {preset.body.split('\n').filter((line) => line.startsWith('-')).length} rules
          </Text>
          <Pressable
            accessibilityLabel={`Edit ${preset.title} rules`}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5"
            hitSlop={10}
            onPress={() =>
              router.push({ pathname: '/settings/preset/[id]', params: { id: preset.id } })
            }
          >
            <PencilLine color={colors.accentBlue} size={14} strokeWidth={2} />
            <Text className="font-body-semibold text-[13px] text-accent-blue">Edit rules</Text>
          </Pressable>
        </View>
      ) : null}
    </PressableScale>
  );
}
