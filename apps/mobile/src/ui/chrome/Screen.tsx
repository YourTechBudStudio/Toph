import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gutter } from '../theme';
import { Backdrop } from './Backdrop';

/**
 * The screen frame: canvas, nebula backdrop, an optional fixed header, and a scrolling body on the
 * gutter that clears the system bars. Taps reach buttons while the keyboard is up.
 */
export function Screen({ children, header }: { children: ReactNode; header?: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-canvas">
      <Backdrop />
      {header === undefined ? null : (
        <View style={{ paddingHorizontal: gutter - 4, paddingTop: insets.top + 6 }}>{header}</View>
      )}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: header === undefined ? insets.top + 12 : 12,
          paddingBottom: insets.bottom + 48,
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}
