import { Check } from 'lucide-react-native';
import { Fragment } from 'react';
import { Text, View } from 'react-native';

import { colors } from '../theme';
import { cn } from './cn';
import { PressableScale } from './PressableScale';

export interface Option<T extends string> {
  value: T;
  title: string;
  detail?: string | undefined;
  badge?: string | undefined;
}

/** A single-choice picker drawn as a card of rows, the chosen one checked. */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      className="overflow-hidden rounded-card border border-line bg-white/3"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Fragment key={option.value}>
            {index === 0 ? null : <View className="mx-4 h-px bg-line" />}
            <PressableScale
              accessibilityLabel={option.title}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              pressedScale={0.985}
              className={cn('flex-row items-center gap-3 px-4 py-3.5', selected && 'bg-spark/8')}
            >
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-body-semibold text-base text-text-primary">
                    {option.title}
                  </Text>
                  {option.badge === undefined ? null : (
                    <Text className="rounded-full bg-white/6 px-2 py-0.5 font-body-semibold text-[11px] text-text-tertiary">
                      {option.badge}
                    </Text>
                  )}
                </View>
                {option.detail === undefined ? null : (
                  <Text className="mt-0.5 font-body text-sm text-text-tertiary">
                    {option.detail}
                  </Text>
                )}
              </View>
              <View
                className={cn(
                  'size-6 items-center justify-center rounded-full border',
                  selected ? 'border-spark bg-spark' : 'border-line-strong',
                )}
              >
                {selected ? <Check color={colors.canvas} size={14} strokeWidth={3} /> : null}
              </View>
            </PressableScale>
          </Fragment>
        );
      })}
    </View>
  );
}
