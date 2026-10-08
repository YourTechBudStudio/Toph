import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { colors } from '../theme';
import { cn } from './cn';
import { PressableScale } from './PressableScale';

const ACKNOWLEDGE_MS = 1500;

/** A small pill that copies `text` to the clipboard and says so for a moment. */
export function CopyButton({
  text,
  what,
  label = 'Copy',
}: {
  text: string;
  what: string;
  label?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acknowledge = () => {
    setCopied(true);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), ACKNOWLEDGE_MS);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return (
    <PressableScale
      accessibilityLabel={`Copy ${what}`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        void Clipboard.setStringAsync(text).then(acknowledge, (error: unknown) => {
          console.warn('Copy failed', error);
        });
      }}
      pressedScale={0.94}
      className={cn(
        'h-9 flex-row items-center gap-1.5 rounded-full border px-3.5',
        copied ? 'border-accent-green/30 bg-accent-green/12' : 'border-line-strong bg-white/5',
      )}
    >
      {copied ? (
        <Check color={colors.accentGreen} size={15} strokeWidth={2.2} />
      ) : (
        <Copy color={colors.textSecondary} size={15} strokeWidth={1.9} />
      )}
      <Text
        className={cn(
          'font-body-semibold text-[13px]',
          copied ? 'text-accent-green' : 'text-text-secondary',
        )}
      >
        {copied ? 'Copied' : label}
      </Text>
    </PressableScale>
  );
}
