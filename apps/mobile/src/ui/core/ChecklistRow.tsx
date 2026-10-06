import { Check, type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Text, View } from 'react-native';

import { colors, type Tone } from '../theme';
import { Button } from './Button';
import { IconTile } from './IconTile';

/**
 * One thing to grant or turn on, as a row: what it is, one line on why, and either the way to do
 * it or a check once it is done. Rows stack on a single card with hairlines between them.
 */
export function ChecklistRow({
  icon,
  tone,
  title,
  why,
  action,
  done,
  pending,
  optional = false,
  disabled = false,
  onAction,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  why: string;
  action: string;
  done: boolean;
  pending: boolean;
  optional?: boolean | undefined;
  disabled?: boolean | undefined;
  onAction: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3.5 px-4 py-4">
      <IconTile icon={icon} tone={done ? 'green' : tone} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-body-bold text-base text-text-primary">{title}</Text>
          {optional ? (
            <Text className="rounded-full bg-white/6 px-2 py-0.5 font-body-semibold text-[11px] text-text-tertiary">
              Optional
            </Text>
          ) : null}
        </View>
        <Text className="mt-0.5 font-body text-[13px] leading-4.5 text-text-secondary">{why}</Text>
      </View>
      {done ? (
        <View
          accessibilityLabel={`${title} done`}
          className="size-8 items-center justify-center rounded-full bg-accent-green"
        >
          <Check color={colors.canvas} size={16} strokeWidth={3} />
        </View>
      ) : pending ? (
        <View className="h-9 w-16 items-center justify-center">
          <ActivityIndicator color={colors.spark} />
        </View>
      ) : (
        <Button
          disabled={disabled}
          onPress={onAction}
          size="sm"
          title={action}
          variant={optional ? 'secondary' : 'primary'}
        />
      )}
    </View>
  );
}
