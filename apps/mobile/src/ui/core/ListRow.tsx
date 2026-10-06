import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { colors, type Tone } from '../theme';
import { IconTile } from './IconTile';
import { PressableScale } from './PressableScale';

/**
 * One settings-style row: a tinted icon, a title with one line of detail, and a trailing slot.
 * Given `onPress`, the whole row is the target and the trailing slot defaults to a chevron.
 */
export function ListRow({
  icon,
  tone = 'neutral',
  title,
  detail,
  trailing,
  onPress,
}: {
  icon: LucideIcon;
  tone?: Tone | undefined;
  title: string;
  detail?: string | undefined;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
}) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} />
      <View className="flex-1">
        <Text className="font-body-semibold text-base text-text-primary">{title}</Text>
        {detail === undefined ? null : (
          <Text className="mt-0.5 font-body text-sm text-text-tertiary" numberOfLines={2}>
            {detail}
          </Text>
        )}
      </View>
      {trailing ??
        (onPress === undefined ? null : (
          <ChevronRight color={colors.textTertiary} size={18} strokeWidth={2} />
        ))}
    </>
  );

  if (onPress === undefined) {
    return <View className="min-h-17 flex-row items-center gap-4 px-4 py-3">{body}</View>;
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      pressedScale={0.985}
      className="min-h-17 flex-row items-center gap-4 px-4 py-3"
    >
      {body}
    </PressableScale>
  );
}

/** Stacks rows on one card with hairlines between them. */
export function RowGroup({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-card border border-line bg-white/3">{children}</View>
  );
}

export function RowDivider() {
  return <View className="ml-18 h-px bg-line" />;
}
