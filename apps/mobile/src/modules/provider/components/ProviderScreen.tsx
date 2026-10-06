import { Text, View } from 'react-native';

import { BackBar, Card, FadeIn, PageTitle, Screen, SectionLabel } from '../../../ui';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionStatusPill } from './ConnectionStatusPill';
import { PolishFields, TranscriptionFields } from './ModelFields';

export function ProviderScreen() {
  return (
    <Screen header={<BackBar trailing={<ConnectionStatusPill />} />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Provider"
          title="OpenAI, by API key."
          description="Your audio goes straight from this phone to the endpoint. I'm just the middleware with opinions."
        />
      </FadeIn>

      <FadeIn index={1}>
        <View className="mt-8">
          <SectionLabel>Connection</SectionLabel>
          <Card>
            <ConnectionForm />
          </Card>
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <View className="mt-9">
          <SectionLabel>Transcription</SectionLabel>
          <Card>
            <TranscriptionFields />
          </Card>
        </View>
      </FadeIn>

      <FadeIn index={3}>
        <View className="mt-9">
          <SectionLabel>Polish</SectionLabel>
          <Card>
            <PolishFields />
          </Card>
          <Text className="mt-4 px-1 font-body text-[13px] leading-5 text-text-tertiary">
            ChatGPT sign-in stays on desktop. OAuth callbacks and phones are still working through
            their differences.
          </Text>
        </View>
      </FadeIn>
    </Screen>
  );
}
