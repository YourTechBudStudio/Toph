import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors, withAlpha } from '../theme';

/**
 * The nebula wash behind every screen: three faint full-bleed gradients at different angles, the
 * same atmosphere as the desktop backdrop. Each layer covers the whole screen, so no edge shows.
 * The voice keyboard does not draw it: its panel uses the system's dark neutral to sit with other keyboards.
 */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[withAlpha(colors.accentBlue, 0.09), withAlpha(colors.accentBlue, 0)]}
        end={{ x: 0.7, y: 0.55 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[withAlpha(colors.accentViolet, 0), withAlpha(colors.accentViolet, 0.07)]}
        end={{ x: 1, y: 0.95 }}
        start={{ x: 0.25, y: 0.25 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[withAlpha(colors.accentCyan, 0), withAlpha(colors.accentCyan, 0.05)]}
        end={{ x: 0.2, y: 1 }}
        start={{ x: 0.6, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
