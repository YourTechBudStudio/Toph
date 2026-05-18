import type { ProviderId } from '@toph/desktop-contracts';

import type { AppSettingsStore } from '../../settings/app-settings-store';
import type { InferenceProvider, InferenceProviderResult } from '../inference-provider';

export function createRoutingInferenceProvider(options: {
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
  providers: Record<ProviderId, InferenceProvider | null>;
}): InferenceProvider {
  return {
    id: 'routing',
    async inferText(input): Promise<InferenceProviderResult> {
      const providerId = options.settingsStore.getSettings().inference.providerId;
      const provider = options.providers[providerId];
      if (!provider) {
        throw new Error(`Inference provider ${providerId} is not available.`);
      }
      return provider.inferText(input);
    },
  };
}
