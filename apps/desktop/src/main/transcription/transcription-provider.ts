import type { ProviderUsageDetails } from '../provider-usage';

export interface TranscriptionProviderResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
}

export interface TranscriptionProvider {
  id: string;
  transcribeBatch: (input: {
    batchId: string;
    audioPath: string;
    durationMs: number;
    signal?: AbortSignal;
  }) => Promise<TranscriptionProviderResult>;
}

export class TransientTranscriptionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientTranscriptionProviderError';
  }
}

export function isTransientTranscriptionProviderError(
  error: unknown,
): error is TransientTranscriptionProviderError {
  return (
    error instanceof TransientTranscriptionProviderError ||
    (error instanceof Error && error.name === 'TransientTranscriptionProviderError')
  );
}
