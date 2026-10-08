import { LinearGradient } from 'expo-linear-gradient';
import { AudioLines, Mic, Square } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { colors, easeOut, withAlpha } from '../../../ui';
import type { DictationPhase } from '../state/session-store';

const ORB = 132;
const STAGE = 248;
const RING_STAGGER_MS = 700;
const RING_MS = 2100;

type Mode = 'rest' | 'live' | 'busy';

function modeOf(phase: DictationPhase): Mode {
  if (phase === 'listening') {
    return 'live';
  }
  if (phase === 'transcribing') {
    return 'busy';
  }
  return 'rest';
}

/**
 * The record control and the centrepiece of Home. At rest it breathes; while listening it turns
 * "on air" and sends ripples outward; while transcribing an arc orbits it. Reduced motion keeps
 * every state, without the movement.
 */
export function RecordOrb({ phase, onPress }: { phase: DictationPhase; onPress: () => void }) {
  const mode = modeOf(phase);
  const reduceMotion = useReducedMotion();
  const live = useSharedValue(0);
  const press = useSharedValue(0);

  useEffect(() => {
    live.value = reduceMotion
      ? Number(mode === 'live')
      : withTiming(Number(mode === 'live'), { duration: 600, easing: easeOut });
  }, [live, mode, reduceMotion]);

  const onAir = useAnimatedStyle(() => ({ opacity: live.value }));
  const core = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.06 }],
  }));

  const label =
    mode === 'live' ? 'Stop recording' : mode === 'busy' ? 'Transcribing' : 'Start recording';
  const Icon = mode === 'live' ? Square : mode === 'busy' ? AudioLines : Mic;

  return (
    <View className="items-center justify-center" style={{ width: STAGE, height: STAGE }}>
      <BreathingHalo active={mode === 'rest'} />
      {[0, 1, 2].map((index) => (
        <Ripple key={index} active={mode === 'live'} delay={index * RING_STAGGER_MS} />
      ))}
      <OrbitArc active={mode === 'busy'} />

      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ busy: mode === 'busy', disabled: mode === 'busy' }}
        disabled={mode === 'busy'}
        onPress={onPress}
        onPressIn={() => {
          press.value = reduceMotion ? 0 : withSpring(1, { damping: 20, stiffness: 400 });
        }}
        onPressOut={() => {
          press.value = withSpring(0, { damping: 12, stiffness: 220 });
        }}
      >
        <Animated.View
          style={[
            {
              width: ORB,
              height: ORB,
              borderRadius: ORB / 2,
              overflow: 'hidden',
              boxShadow: `0px 0px 48px ${withAlpha(mode === 'live' ? colors.accentRed : colors.spark, 0.45)}`,
            },
            core,
          ]}
        >
          <LinearGradient
            colors={[colors.spark, colors.accentBlue, colors.accentViolet]}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, onAir]}>
            <LinearGradient
              colors={[colors.accentAmber, colors.accentRed]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {/* A soft top-left sheen, so the orb reads as lit rather than flat. */}
          <LinearGradient
            colors={[withAlpha(colors.white, 0.28), withAlpha(colors.white, 0)]}
            end={{ x: 0.6, y: 0.6 }}
            start={{ x: 0.15, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View className="flex-1 items-center justify-center">
            <Icon
              color={colors.canvas}
              fill={mode === 'live' ? colors.canvas : 'none'}
              size={mode === 'live' ? 34 : 44}
              strokeWidth={mode === 'live' ? 0 : 2}
            />
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

/** At rest the orb sits in a slow, breathing halo, an invitation rather than an alarm. */
function BreathingHalo({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);
  const shown = useSharedValue(Number(active));

  useEffect(() => {
    shown.value = withTiming(Number(active), { duration: 500 });
    if (!active || reduceMotion) {
      cancelAnimation(breath);
      return;
    }
    breath.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [active, breath, reduceMotion, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value * (0.35 + breath.value * 0.3),
    transform: [{ scale: 1.18 + breath.value * 0.08 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: ORB,
          height: ORB,
          borderRadius: ORB / 2,
          borderWidth: 1.5,
          borderColor: withAlpha(colors.spark, 0.6),
          backgroundColor: withAlpha(colors.spark, 0.06),
        },
        style,
      ]}
    />
  );
}

/** While listening, rings leave the orb and fade, like sound leaving a speaker. */
function Ripple({ active, delay }: { active: boolean; delay: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(Number(active), { duration: 400 });
    if (!active || reduceMotion) {
      cancelAnimation(progress);
      progress.value = reduceMotion && active ? 0.35 : 0;
      return;
    }
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: RING_MS, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [active, delay, progress, reduceMotion, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value * (1 - progress.value) * 0.6,
    transform: [{ scale: 1 + progress.value * 0.85 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: ORB,
          height: ORB,
          borderRadius: ORB / 2,
          borderWidth: 2,
          borderColor: colors.accentRed,
        },
        style,
      ]}
    />
  );
}

const ARC_SIZE = ORB + 30;
const ARC_RADIUS = ARC_SIZE / 2 - 3;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;

/** While the transcript is being made, a bright arc orbits the orb. */
function OrbitArc({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(Number(active), { duration: 400 });
    if (!active || reduceMotion) {
      cancelAnimation(turn);
      return;
    }
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [active, reduceMotion, shown, turn]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ rotate: `${String(turn.value * 360)}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: ARC_SIZE, height: ARC_SIZE }, style]}
    >
      <Svg height={ARC_SIZE} width={ARC_SIZE}>
        <Circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          fill="none"
          r={ARC_RADIUS}
          stroke={colors.lineStrong}
          strokeWidth={3}
        />
        <Circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          fill="none"
          r={ARC_RADIUS}
          stroke={colors.spark}
          strokeDasharray={`${String(ARC_LENGTH * 0.22)} ${String(ARC_LENGTH)}`}
          strokeLinecap="round"
          strokeWidth={3}
        />
      </Svg>
    </Animated.View>
  );
}
