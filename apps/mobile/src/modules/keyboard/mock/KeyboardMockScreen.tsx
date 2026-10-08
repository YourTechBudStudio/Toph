// THROWAWAY MOCK (story #8 UI exploration); see `mock-keyboard.ts`.
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, cn, PressableScale, SegmentedControl } from '../../../ui';
import { MOCK_PHASES, useMockKeyboard } from './mock-keyboard';
import { MockKeyboardPanel, type PanelVariant } from './MockKeyboardPanel';

/**
 * A stand-in for some other app (a light chat app), so the keyboard is judged where it will live.
 * These are deliberately not Toph tokens: the host is not Toph.
 */
const host = {
  canvas: '#ffffff',
  bar: '#f3f4f6',
  text: '#1f2328',
  muted: '#6b7280',
  bubble: '#e9ecef',
  mine: '#0b57d0',
  key: '#ffffff',
  keyboard: '#e3e6ea',
  toast: '#303134',
} as const;

/** Android's system keyboard switch animation is about this long. */
const IME_MS = 260;

const VARIANTS = [
  { value: 'stacked', label: 'Stacked' },
  { value: 'compact', label: 'Compact' },
] as const satisfies readonly { value: PanelVariant; label: string }[];

/** The mock's one screen: controls, a fake host app, and the keyboard docked under it. */
export function KeyboardMockScreen() {
  const insets = useSafeAreaInsets();
  const keyboard = useMockKeyboard();
  const [variant, setVariant] = useState<PanelVariant>('compact');
  const [controlsOpen, setControlsOpen] = useState(true);

  return (
    <View className="flex-1" style={{ backgroundColor: host.canvas }}>
      <Controls
        keyboard={keyboard}
        onToggle={() => setControlsOpen((open) => !open)}
        onVariant={setVariant}
        open={controlsOpen}
        topInset={insets.top}
        variant={variant}
      />

      <HostApp fieldText={keyboard.fieldText} focused={keyboard.shown || keyboard.previousShown} />

      {keyboard.shown ? (
        <Animated.View
          entering={SlideInDown.duration(IME_MS)}
          exiting={SlideOutDown.duration(IME_MS)}
          key={`toph-${variant}`}
        >
          <MockKeyboardPanel
            onCaption={keyboard.tapCaption}
            onOrb={keyboard.tapOrb}
            phase={keyboard.phase}
            startedAt={keyboard.startedAt}
            variant={variant}
          />
        </Animated.View>
      ) : keyboard.previousShown ? (
        <Animated.View
          entering={SlideInDown.duration(IME_MS)}
          exiting={SlideOutDown.duration(IME_MS)}
        >
          <PreviousKeyboard bottomInset={insets.bottom} />
        </Animated.View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}

      {keyboard.toast === null ? null : (
        <Animated.View
          className="absolute right-0 left-0 items-center"
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(180)}
          pointerEvents="none"
          style={{ bottom: insets.bottom + 72 }}
        >
          <View className="rounded-full px-5 py-3" style={{ backgroundColor: host.toast }}>
            <Text className="font-body-medium text-sm text-white">{keyboard.toast}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function Controls({
  keyboard,
  variant,
  open,
  topInset,
  onVariant,
  onToggle,
}: {
  keyboard: ReturnType<typeof useMockKeyboard>;
  variant: PanelVariant;
  open: boolean;
  topInset: number;
  onVariant: (next: PanelVariant) => void;
  onToggle: () => void;
}) {
  return (
    <View className="bg-canvas px-4 pb-3" style={{ paddingTop: topInset + 8 }}>
      <Pressable
        accessibilityRole="button"
        className="flex-row items-center justify-between py-1"
        onPress={onToggle}
      >
        <Text className="font-body-bold text-xs tracking-[1.6px] text-spark uppercase">
          Keyboard mock
        </Text>
        <Text className="font-body-semibold text-[13px] text-text-secondary">
          {open ? 'Hide controls' : 'Show controls'}
        </Text>
      </Pressable>
      {open ? (
        <View className="mt-2 gap-3">
          <SegmentedControl
            label="Layout"
            onChange={onVariant}
            options={VARIANTS}
            value={variant}
          />
          <ScrollView
            contentContainerStyle={{ gap: 6 }}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {MOCK_PHASES.map((option) => {
              const selected = keyboard.shown && option.value === keyboard.phase;
              return (
                <PressableScale
                  key={option.value}
                  accessibilityRole="button"
                  className={cn(
                    'h-8 justify-center rounded-full px-3',
                    selected ? 'bg-spark' : 'border border-line-strong bg-white/6',
                  )}
                  onPress={() => keyboard.jump(option.value)}
                >
                  <Text
                    className={cn(
                      'font-body-bold text-[13px]',
                      selected ? 'text-canvas' : 'text-text-primary',
                    )}
                  >
                    {option.label}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
          <View className="flex-row gap-2">
            {keyboard.shown ? (
              <Button onPress={keyboard.hide} size="sm" title="Close keyboard" />
            ) : (
              <Button onPress={keyboard.show} size="sm" title="Switch to Toph Voice" />
            )}
            <Button onPress={keyboard.reset} size="sm" title="Reset" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A plain chat thread with a compose field: where the transcript lands. */
function HostApp({ fieldText, focused }: { fieldText: string; focused: boolean }) {
  return (
    <View className="flex-1">
      <View className="px-4 py-3" style={{ backgroundColor: host.bar }}>
        <Text className="font-body-bold text-base" style={{ color: host.text }}>
          Sam
        </Text>
        <Text className="font-body text-xs" style={{ color: host.muted }}>
          Messages (stand-in for any app)
        </Text>
      </View>
      <View className="flex-1 justify-end gap-2 px-4 py-3">
        <View
          className="max-w-[78%] self-start rounded-2xl px-3.5 py-2"
          style={{ backgroundColor: host.bubble }}
        >
          <Text className="font-body text-[15px]" style={{ color: host.text }}>
            Are you still coming tonight?
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2 px-3 pb-2">
        <View
          className="min-h-11 flex-1 justify-center rounded-3xl border px-4 py-2"
          style={{ backgroundColor: host.bar, borderColor: focused ? host.mine : host.bar }}
        >
          <Text
            className="font-body text-[15px]"
            style={{ color: fieldText === '' ? host.muted : host.text }}
          >
            {fieldText === '' ? 'Message' : fieldText}
            {focused ? <Text style={{ color: host.mine }}>|</Text> : null}
          </Text>
        </View>
      </View>
    </View>
  );
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const;

/** The keyboard Android switches back to after an insert: a generic QWERTY stand-in. */
function PreviousKeyboard({ bottomInset }: { bottomInset: number }) {
  return (
    <View
      className="gap-2.5 px-1 pt-2.5"
      style={{ backgroundColor: host.keyboard, paddingBottom: bottomInset + 10 }}
    >
      {ROWS.map((row) => (
        <View key={row} className="flex-row justify-center gap-1.5">
          {[...row].map((letter) => (
            <View
              key={letter}
              className="h-11 w-8 items-center justify-center rounded-md"
              style={{ backgroundColor: host.key }}
            >
              <Text className="font-body text-lg" style={{ color: host.text }}>
                {letter}
              </Text>
            </View>
          ))}
        </View>
      ))}
      <View className="flex-row justify-center gap-1.5">
        <View className="h-11 w-56 rounded-md" style={{ backgroundColor: host.key }} />
      </View>
    </View>
  );
}
