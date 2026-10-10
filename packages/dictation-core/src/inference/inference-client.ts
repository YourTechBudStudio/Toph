import type { ProviderUsageDetails } from '../usage/provider-usage';

export interface InferenceClientResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
}

export interface InferenceClient {
  id: string;
  inferText: (input: {
    instructions: string;
    inputText: string;
    signal?: AbortSignal | undefined;
  }) => Promise<InferenceClientResult>;
}

export class TransientInferenceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientInferenceProviderError';
  }
}

export function isTransientInferenceProviderError(
  error: unknown,
): error is TransientInferenceProviderError {
  return error instanceof TransientInferenceProviderError;
}
