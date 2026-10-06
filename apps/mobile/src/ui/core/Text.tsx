import type { ReactNode } from 'react';
import { Text } from 'react-native';

import { cn } from './cn';

/** Small uppercase label that opens a group of rows. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text
      className={cn(
        'mb-3 font-body-bold text-xs tracking-[1.6px] text-text-tertiary uppercase',
        className,
      )}
    >
      {children}
    </Text>
  );
}

/** The large title block that opens a screen: eyebrow, headline, and one line of context. */
export function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string | undefined;
  title: string;
  description?: string | undefined;
}) {
  return (
    <>
      {eyebrow === undefined ? null : (
        <Text className="mb-2 font-body-bold text-xs tracking-[1.6px] text-spark uppercase">
          {eyebrow}
        </Text>
      )}
      <Text className="font-display text-[32px] leading-9.5 tracking-[-1px] text-text-primary">
        {title}
      </Text>
      {description === undefined ? null : (
        <Text className="mt-3 font-body text-base leading-6 text-text-secondary">
          {description}
        </Text>
      )}
    </>
  );
}
