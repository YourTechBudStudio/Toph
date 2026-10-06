import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { IconButton } from '../core';

/** The fixed bar of a pushed screen: a way back, and room for one trailing action. */
export function BackBar({ trailing }: { trailing?: ReactNode }) {
  return (
    <View className="h-12 flex-row items-center justify-between">
      <IconButton icon={ChevronLeft} label="Back" onPress={() => router.back()} />
      {trailing}
    </View>
  );
}
