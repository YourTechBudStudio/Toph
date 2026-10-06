import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { colors } from '../theme';
import { cn } from './cn';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'sm';

const frame: Record<Size, string> = {
  md: 'h-12 gap-2 px-5',
  sm: 'h-9 gap-1.5 px-4',
};

const labelSize: Record<Size, string> = {
  md: 'text-[15px]',
  sm: 'text-[13px]',
};

const surface: Record<Variant, string> = {
  primary: 'bg-spark',
  secondary: 'border border-line-strong bg-white/6',
  danger: 'border border-accent-red/25 bg-accent-red/12',
};

const label: Record<Variant, string> = {
  primary: 'text-canvas',
  secondary: 'text-text-primary',
  danger: 'text-accent-red',
};

const iconColor: Record<Variant, string> = {
  primary: colors.canvas,
  secondary: colors.textPrimary,
  danger: colors.accentRed,
};

export function Button({
  title,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  disabled,
  className,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant | undefined;
  size?: Size | undefined;
  icon?: LucideIcon | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      outerClassName={className}
      className={cn(
        'flex-row items-center justify-center rounded-full',
        frame[size],
        surface[variant],
      )}
    >
      {Icon === undefined ? null : (
        <Icon color={iconColor[variant]} size={size === 'sm' ? 14 : 17} strokeWidth={2} />
      )}
      <View>
        <Text className={cn('font-body-bold', labelSize[size], label[variant])}>{title}</Text>
      </View>
    </PressableScale>
  );
}
