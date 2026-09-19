import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  TransientTranscriptionProviderError,
  type ProviderClientContext,
  type TranscriptionClient,
  type TranscriptionClientResult,
} from '../provider-definition';
import {
  endpointFromCredentials,
  isOfficialOpenAiEndpoint,
  isRetryableStatus,
  readRequestId,
  readResponseBody,
} from './http';

const providerId = 'openai';

/**
 * `null` means the response carried no transcript at all, which is a malformed response. An empty
 * string means the model heard nothing, which is the ordinary result for a silent or noise-only
 * batch and a success. The two are kept apart so silence is not reported as a provider failure.
 */
function readTranscriptText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const candidate = body as { text?: unknown };
  return typeof candidate.text === 'string' ? candidate.text : null;
}

export function createOpenAiTranscriptionClient(
  context: ProviderClientContext,
): TranscriptionClient {
  return {
    id: providerId,

    async transcribeBatch(input): Promise<TranscriptionClientResult> {
      const credentials = await context.credentials();
      const { baseUrl, apiKey } = endpointFromCredentials(credentials.formValues);
      const model = input.model;
      const audio = await readFile(input.audioPath);
      const form = new FormData();
      form.set('file', new Blob([audio], { type: 'audio/wav' }), basename(input.audioPath));
      form.set('model', model);
      form.set('response_format', 'json');

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientTranscriptionProviderError(
          `OpenAI transcription request failed: ${String(error)}`,
        );
      }

      const requestId = readRequestId(response);
      const body = await readResponseBody(response);

      if (!response.ok) {
        const message = `OpenAI transcription failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 2000)}`;
        if (isRetryableStatus(response.status)) {
          throw new TransientTranscriptionProviderError(message);
        }
        throw new Error(message);
      }

      // `null` means the body read itself failed mid-stream, which is a transport fault rather than
      // anything the provider said. Classified before the shape check, which would otherwise read a
      // dropped connection as a malformed response and lose the batch without a retry.
      if (body === null) {
        throw new TransientTranscriptionProviderError(
          'OpenAI transcription response body could not be read.',
        );
      }

      const text = readTranscriptText(body);
      if (text === null) {
        throw new Error('OpenAI transcription response did not include transcript text.');
      }

      const cost = context.pricing.estimateCost({
        providerId,
        model,
        usage: {
          kind: 'audio_duration',
          durationMs: input.durationMs,
        },
        allowStaticFallback: isOfficialOpenAiEndpoint(baseUrl),
      });

      return {
        text,
        provider: providerId,
        model,
        usage: {
          billingMode: context.billingMode,
          audioDurationMs: input.durationMs,
          billableDurationMs: input.durationMs,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          estimatedCostUsdMicros: cost.costUsdMicros,
          costSource: cost.costSource,
          pricingCatalogProviderId: cost.pricingCatalogProviderId,
          pricingCatalogModelId: cost.pricingCatalogModelId,
        },
        providerRequestId: requestId,
        providerResponseJson: body,
      };
    },
  };
}
