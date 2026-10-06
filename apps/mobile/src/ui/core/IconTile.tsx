import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { toneColor, type Tone } from '../theme';
import { cn } from './cn';

const tileSurface: Record<Tone, string> = {
  neutral: 'bg-white/6',
  blue: 'bg-accent-blue/14',
  violet: 'bg-accent-violet/14',
  green: 'bg-accent-green/14',
  amber: 'bg-accent-amber/14',
  red: 'bg-accent-red/14',
  cyan: 'bg-accent-cyan/14',
};

/** A rounded square holding a tinted icon: the leading mark of rows and setup steps. */
export function IconTile({
  icon: Icon,
  tone = 'neutral',
  size = 40,
}: {
  icon: LucideIcon;
  tone?: Tone | undefined;
  size?: number | undefined;
}) {
  return (
    <View
      className={cn('items-center justify-center rounded-tile', tileSurface[tone])}
      style={{ width: size, height: size }}
    >
      <Icon color={toneColor[tone]} size={Math.round(size * 0.45)} strokeWidth={1.9} />
    </View>
  );
}
