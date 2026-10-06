import type { LucideIcon } from 'lucide-react-native';

import { colors } from '../theme';
import { PressableScale } from './PressableScale';

/** A round, quiet control holding one icon. Hit area stays at 44. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      pressedScale={0.92}
      className="size-11 items-center justify-center rounded-full border border-line bg-white/4"
    >
      <Icon color={colors.textSecondary} size={19} strokeWidth={1.8} />
    </PressableScale>
  );
}
