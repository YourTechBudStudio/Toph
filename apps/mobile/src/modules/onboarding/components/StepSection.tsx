import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn, colors } from '../../../ui';

/**
 * One numbered onboarding step on a vertical rail: the marker turns into a check when the step is
 * done, and a line leads to the next step.
 */
export function StepSection({
  number,
  title,
  complete,
  optional = false,
  last = false,
  children,
}: {
  number: number;
  title: string;
  complete: boolean;
  optional?: boolean | undefined;
  last?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <View className="flex-row gap-4">
      <View className="items-center">
        <View
          className={cn(
            'size-8 items-center justify-center rounded-full border',
            complete ? 'border-accent-green bg-accent-green' : 'border-line-strong bg-white/4',
          )}
        >
          {complete ? (
            <Check color={colors.canvas} size={16} strokeWidth={3} />
          ) : (
            <Text className="font-display text-sm text-text-secondary">{number}</Text>
          )}
        </View>
        {last ? null : (
          <View
            className={cn('mt-2 w-px flex-1', complete ? 'bg-accent-green/40' : 'bg-line-strong')}
          />
        )}
      </View>
      <View className={cn('flex-1', !last && 'pb-9')}>
        <View className="mb-4 h-8 flex-row items-center justify-between">
          <Text className="font-display text-lg text-text-primary">{title}</Text>
          <Text
            className={cn(
              'font-body-semibold text-xs tracking-[1px] uppercase',
              complete ? 'text-accent-green' : 'text-text-tertiary',
            )}
          >
            {complete ? 'Done' : optional ? 'Optional' : 'Required'}
          </Text>
        </View>
        {children}
      </View>
    </View>
  );
}
