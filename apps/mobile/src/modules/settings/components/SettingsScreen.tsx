import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Activity, BookA, Info, KeyRound, Scale, WandSparkles } from 'lucide-react-native';
import { Alert, Text, View } from 'react-native';

import {
  BackBar,
  FadeIn,
  ListRow,
  PageTitle,
  RowDivider,
  RowGroup,
  Screen,
  SectionLabel,
} from '../../../ui';
import { runParityCheck } from '../../dictation';
import { KeyboardRow } from '../../keyboard';
import { PermissionRow } from '../../permissions';
import { usePolishSummary } from '../../polish';
import { useProviderSummary } from '../../provider';

/** The settings hub: one row per area, each saying where it stands before you open it. */
export function SettingsScreen() {
  const provider = useProviderSummary();
  const polish = usePolishSummary();

  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Settings"
          title="Config, but friendly."
          description="Everything lives on this phone. No sync, no telemetry, no YAML."
        />
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-9">
          <SectionLabel>Dictation</SectionLabel>
          <RowGroup>
            <ListRow
              detail={
                provider.connected ? `OpenAI · ${provider.transcriptionModel}` : 'Not connected yet'
              }
              icon={KeyRound}
              onPress={() => router.push('/settings/provider')}
              title="Provider"
              tone="blue"
            />
            <RowDivider />
            <ListRow
              detail={polish.enabled ? `On · ${polish.presetTitle}` : 'Off · raw transcripts'}
              icon={WandSparkles}
              onPress={() => router.push('/settings/polish')}
              title="Polish"
              tone="green"
            />
            <RowDivider />
            <ListRow
              detail={`${String(polish.activeTerms)} active terms`}
              icon={BookA}
              onPress={() => router.push('/settings/dictionary')}
              title="Dictionary"
              tone="cyan"
            />
          </RowGroup>
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-9">
          <SectionLabel>Keyboard</SectionLabel>
          <RowGroup>
            <KeyboardRow />
            <RowDivider />
            <PermissionRow permission="microphone" />
            <RowDivider />
            <PermissionRow optional permission="notifications" />
          </RowGroup>
        </View>
      </FadeIn>

      <FadeIn index={3}>
        <View className="mt-9">
          <SectionLabel>About</SectionLabel>
          <RowGroup>
            <ListRow
              detail={`Version ${Constants.expoConfig?.version ?? 'unknown'}`}
              icon={Info}
              title="Toph for Android"
            />
            <RowDivider />
            <ListRow
              detail="Silero VAD, ONNX Runtime, Expo and more"
              icon={Scale}
              onPress={() => router.push('/settings/licenses')}
              title="Open-source notices"
            />
            {__DEV__ ? (
              <>
                <RowDivider />
                <ListRow
                  detail="Score files/parity/raw.wav for desktop's parity script"
                  icon={Activity}
                  onPress={checkParity}
                  title="Run parity check"
                  tone="amber"
                />
              </>
            ) : null}
          </RowGroup>
          <Text className="mt-6 text-center font-body text-[13px] leading-5 text-text-tertiary">
            Built on desktop's dictation engine.{'\n'}Same VAD, same chunking, smaller screen.
          </Text>
        </View>
      </FadeIn>
    </Screen>
  );
}

/** Dev only: runs the mobile half of the parity check and reports what it wrote, or why it failed. */
function checkParity(): void {
  runParityCheck().then(
    ({ frames, regions, batches }) => {
      Alert.alert(
        'Parity check',
        `${String(frames)} frames, ${String(regions)} regions, ${String(batches)} batches. Wrote files/parity/mobile.json.`,
      );
    },
    (error: unknown) => {
      Alert.alert('Parity check', error instanceof Error ? error.message : String(error));
    },
  );
}
