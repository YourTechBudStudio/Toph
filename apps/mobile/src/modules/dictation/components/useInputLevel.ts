import { useEffect } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { subscribeInputLevel } from '../engine/native-host';

/** RMS at or below this many dBFS draws as silence; at or above `LOUD_DB` it fills the bars. */
const QUIET_DB = -55;
const LOUD_DB = -15;
/** Rise quickly with the voice, fall back slowly, so the bars track speech without flicker. */
const ATTACK_MS = 90;
const RELEASE_MS = 240;

/** Maps RMS to 0..1 on a decibel scale, which is closer to how loud speech sounds than raw RMS. */
function loudness(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)));
}

/**
 * How loud the microphone is right now, from 0 to 1, smoothed for drawing. It follows the native
 * capture's level events while `active` and rests at 0 otherwise. The value lives on the UI
 * thread, so the ~10 events a second never re-render React.
 */
export function useInputLevel(active: boolean): SharedValue<number> {
  const level = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      level.value = withTiming(0, { duration: RELEASE_MS });
      return;
    }
    const subscription = subscribeInputLevel((rms) => {
      const target = loudness(rms);
      level.value = withTiming(target, {
        duration: target > level.value ? ATTACK_MS : RELEASE_MS,
      });
    });
    return () => subscription.remove();
  }, [active, level]);

  return level;
}
