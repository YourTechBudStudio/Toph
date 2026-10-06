import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
} from '@expo-google-fonts/sora';
import {
  SourceSans3_400Regular,
  SourceSans3_500Medium,
  SourceSans3_600SemiBold,
  SourceSans3_700Bold,
} from '@expo-google-fonts/source-sans-3';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../../global.css';
import { OnboardingGate } from '../modules/onboarding';
import { colors } from '../ui';

// Keep Home underneath directly opened routes.
// oxlint-disable-next-line react/only-export-components -- Expo Router reads route configuration here.
export const unstable_settings = { initialRouteName: 'index' };

// Keep the splash up until the fonts are ready; no visible text uses the system font.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
    SourceSans3_400Regular,
    SourceSans3_500Medium,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* Setup is a prerequisite for using the app, not a screen with the app behind it. */}
      <OnboardingGate>
        <Stack
          initialRouteName="index"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.canvas },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="dictation/[id]" />
          <Stack.Screen name="settings/index" />
          <Stack.Screen name="settings/provider" />
          <Stack.Screen name="settings/polish" />
          <Stack.Screen name="settings/preset/[id]" />
          <Stack.Screen name="settings/dictionary" />
        </Stack>
      </OnboardingGate>
    </SafeAreaProvider>
  );
}
