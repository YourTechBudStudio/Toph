import type { ProviderUsageDetails } from '../usage/provider-usage';

export interface TranscriptionClientResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
}

export interface TranscriptionClient {
  id: string;
  transcribeBatch: (input: {
    batchId: string;
    /** The batch's WAV bytes. ArrayBuffer-backed, because that is what a `fetch` body accepts. */
    audio: Uint8Array<ArrayBuffer>;
    durationMs: number;
    model: string;
    signal?: AbortSignal;
  }) => Promise<TranscriptionClientResult>;
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
  return error instanceof TransientTranscriptionProviderError;
}
