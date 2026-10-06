import { router } from 'expo-router';
import { Settings2 } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { FadeIn, IconButton, Screen, StatusPill } from '../../../ui';
import { DictationPanel } from '../../dictation';
import { RecentDictations } from '../../history';
import { useHomeStatus } from './useHomeStatus';

export function HomeScreen() {
  const status = useHomeStatus();

  return (
    <Screen>
      <FadeIn index={0}>
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="font-display-bold text-[40px] leading-11.5 tracking-[-1.6px] text-text-primary">
              Toph
            </Text>
            <View className="mt-2">
              <StatusPill label={status.label} live={status.live} tone={status.tone} />
            </View>
          </View>
          <IconButton icon={Settings2} label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-6">
          <DictationPanel />
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-10">
          <RecentDictations />
        </View>
      </FadeIn>
    </Screen>
  );
}
