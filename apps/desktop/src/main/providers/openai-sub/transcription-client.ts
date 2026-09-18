import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  TransientTranscriptionProviderError,
  type ProviderClientContext,
  type TranscriptionClient,
  type TranscriptionClientResult,
} from '../provider-definition';

const providerId = 'openai-sub';
const endpoint = 'https://chatgpt.com/backend-api/transcribe';

function isRetryableFailure(status: number, body: unknown) {
  if (status === 403 && typeof body === 'string' && /<html|<meta\s+http-equiv=/i.test(body)) {
    return true;
  }

  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function readTranscriptText(body: unknown) {
  if (typeof body === 'string') {
    return body;
  }
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const candidate = body as { text?: unknown; transcript?: unknown };
  if (typeof candidate.text === 'string') {
    return candidate.text;
  }
  if (typeof candidate.transcript === 'string') {
    return candidate.transcript;
  }
  return null;
}

async function readResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<unknown>;
  }

  return response.text();
}

export function createOpenAiSubTranscriptionClient(
  context: ProviderClientContext,
): TranscriptionClient {
  return {
    id: providerId,

    async transcribeBatch(input): Promise<TranscriptionClientResult> {
      const credentials = await context.credentials();
      const model = input.model;
      const audio = await readFile(input.audioPath);
      const form = new FormData();
      form.set('file', new Blob([audio], { type: 'audio/wav' }), basename(input.audioPath));
      form.set('duration_ms', String(input.durationMs));
      form.set('model', model);

      const headers: Record<string, string> = {
        Accept: '*/*',
        Authorization: `Bearer ${credentials.accessToken}`,
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
        'User-Agent': 'Toph (openai-sub transcription)',
        'oai-language': 'en-US',
        'x-openai-target-path': '/backend-api/transcribe',
        'x-openai-target-route': '/backend-api/transcribe',
      };
      if (credentials.accountId) {
        headers['chatgpt-account-id'] = credentials.accountId;
      }

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: form,
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientTranscriptionProviderError(
          `OpenAI-sub transcription request failed: ${String(error)}`,
        );
      }
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
      const body = await readResponseBody(response);

      if (!response.ok) {
        const message = `OpenAI-sub transcription failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 2000)}`;
        if (isRetryableFailure(response.status, body)) {
          throw new TransientTranscriptionProviderError(message);
        }
        throw new Error(message);
      }

      const text = readTranscriptText(body);
      if (!text) {
        throw new Error('OpenAI-sub transcription response did not include transcript text.');
      }

      const cost = context.pricing.estimateCost({
        providerId,
        model,
        usage: {
          kind: 'audio_duration',
          durationMs: input.durationMs,
        },
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
