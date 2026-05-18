import type { ProviderUsageDetails } from '../provider-usage';

export interface InferenceImageInput {
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  detail: 'low' | 'high' | 'auto';
}

export interface InferenceProviderResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
}

export interface InferenceProvider {
  id: string;
  inferText: (input: {
    instructions: string;
    inputText: string;
    images?: InferenceImageInput[];
    signal?: AbortSignal;
  }) => Promise<InferenceProviderResult>;
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
  return (
    error instanceof TransientInferenceProviderError ||
    (error instanceof Error && error.name === 'TransientInferenceProviderError')
  );
}

export class UnsupportedInferenceImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedInferenceImageInputError';
  }
}

export function isUnsupportedInferenceImageInputError(
  error: unknown,
): error is UnsupportedInferenceImageInputError {
  return (
    error instanceof UnsupportedInferenceImageInputError ||
    (error instanceof Error && error.name === 'UnsupportedInferenceImageInputError')
  );
}
