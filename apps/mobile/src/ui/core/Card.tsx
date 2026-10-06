import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { Tone } from '../theme';
import { cn } from './cn';

/** Pastel fills and edges per tone, spelled out so Tailwind sees every class. */
const toneSurface: Record<Tone, string> = {
  neutral: 'bg-white/3 border-line',
  blue: 'bg-accent-blue/10 border-accent-blue/18',
  violet: 'bg-accent-violet/10 border-accent-violet/18',
  green: 'bg-accent-green/10 border-accent-green/18',
  amber: 'bg-accent-amber/10 border-accent-amber/20',
  red: 'bg-accent-red/10 border-accent-red/20',
  cyan: 'bg-accent-cyan/10 border-accent-cyan/18',
};

export function Card({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View className={cn('rounded-card border p-5', toneSurface[tone], className)}>{children}</View>
  );
}
