import type { ProviderId } from '@toph/desktop-contracts';

import type { AppSettingsStore } from '../../settings/app-settings-store';
import type { TranscriptionProvider, TranscriptionProviderResult } from '../transcription-provider';

export function createRoutingTranscriptionProvider(options: {
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
  providers: Record<ProviderId, TranscriptionProvider | null>;
}): TranscriptionProvider {
  return {
    id: 'routing',
    async transcribeBatch(input): Promise<TranscriptionProviderResult> {
      const providerId = options.settingsStore.getSettings().transcription.providerId;
      const provider = options.providers[providerId];
      if (!provider) {
        throw new Error(`Transcription provider ${providerId} is not available.`);
      }
      return provider.transcribeBatch(input);
    },
  };
}
