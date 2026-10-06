import { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';

/** Press compression: quick to give, soft to return. */
export const pressSpring = { damping: 22, stiffness: 420, mass: 0.6 } as const;
export const releaseSpring = { damping: 14, stiffness: 260, mass: 0.7 } as const;

/** The house ease: long, decelerating, never bouncy. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/** Gap between staggered entrances, so a screen settles top to bottom. */
export const STAGGER_MS = 70;

/** A rise-and-fade entrance for the nth block of a screen. Reduced motion shows it in place. */
export function enterFrom(index: number) {
  return FadeInDown.duration(760)
    .delay(index * STAGGER_MS)
    .easing(easeOut)
    .withInitialValues({ transform: [{ translateY: 14 }] })
    .reduceMotion(ReduceMotion.System);
}
