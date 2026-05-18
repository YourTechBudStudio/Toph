import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { PROVIDER_BILLING_MODES } from '@toph/desktop-contracts';

import type {
  ProviderAuthService,
  ProviderCredentials,
} from '../../auth/provider-auth-service';
import type { PricingService } from '../../pricing/pricing-service';
import type { AppSettingsStore } from '../../settings/app-settings-store';
import {
  TransientTranscriptionProviderError,
  type TranscriptionProvider,
  type TranscriptionProviderResult,
} from '../transcription-provider';

const providerId = 'openai-sub';
const endpoint = 'https://chatgpt.com/backend-api/transcribe';

function isRetryableFailure(status: number, body: unknown) {
  if (isOpenAiAuthRefreshPage(status, body)) {
    return true;
  }

  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isOpenAiAuthRefreshPage(status: number, body: unknown) {
  return status === 403 && typeof body === 'string' && /<html|<meta\s+http-equiv=/i.test(body);
}

function formatResponseBodyForError(status: number, body: unknown) {
  if (isOpenAiAuthRefreshPage(status, body)) {
    return 'ChatGPT returned an auth refresh page. Reconnect OpenAI if retrying does not recover.';
  }

  return String(JSON.stringify(body) ?? body)
    .replace(/\s+/g, ' ')
    .slice(0, 2000);
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

export function createOpenAiSubTranscriptionProvider(options: {
  auth: Pick<ProviderAuthService, 'resolveCredentials' | 'refreshCredentials'>;
  pricing: Pick<PricingService, 'estimateCost'>;
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
}): TranscriptionProvider {
  return {
    id: providerId,

    async transcribeBatch(input): Promise<TranscriptionProviderResult> {
      let credentials = await options.auth.resolveCredentials(providerId);
      const model = options.settingsStore.getSettings().transcription.model;
      const audio = await readFile(input.audioPath);

      const createForm = () => {
        const form = new FormData();
        form.set('file', new Blob([audio], { type: 'audio/wav' }), basename(input.audioPath));
        form.set('duration_ms', String(input.durationMs));
        form.set('model', model);
        return form;
      };

      const createHeaders = (resolvedCredentials: ProviderCredentials) => {
        const headers: Record<string, string> = {
          Accept: '*/*',
          Authorization: `Bearer ${resolvedCredentials.accessToken}`,
          Origin: 'https://chatgpt.com',
          Referer: 'https://chatgpt.com/',
          'User-Agent': 'Toph (openai-sub transcription)',
          'oai-language': 'en-US',
          'x-openai-target-path': '/backend-api/transcribe',
          'x-openai-target-route': '/backend-api/transcribe',
        };
        if (resolvedCredentials.accountId) {
          headers['chatgpt-account-id'] = resolvedCredentials.accountId;
        }
        return headers;
      };

      const sendRequest = async (resolvedCredentials: ProviderCredentials) => {
        return fetch(endpoint, {
          method: 'POST',
          headers: createHeaders(resolvedCredentials),
          body: createForm(),
          signal: input.signal,
        });
      };

      let response: Response;
      try {
        response = await sendRequest(credentials);
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientTranscriptionProviderError(
          `OpenAI-sub transcription request failed: ${String(error)}`,
        );
      }
      let body = await readResponseBody(response);
      if (!response.ok && isOpenAiAuthRefreshPage(response.status, body)) {
        try {
          credentials = await options.auth.refreshCredentials(providerId);
          response = await sendRequest(credentials);
          body = await readResponseBody(response);
        } catch (error) {
          if (input.signal?.aborted) {
            throw error;
          }
          throw new TransientTranscriptionProviderError(
            `OpenAI-sub transcription auth refresh failed: ${String(error)}`,
          );
        }
      }
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');

      if (!response.ok) {
        const message = `OpenAI-sub transcription failed: HTTP ${response.status} ${formatResponseBodyForError(
          response.status,
          body,
        )}`;
        if (isRetryableFailure(response.status, body)) {
          throw new TransientTranscriptionProviderError(message);
        }
        throw new Error(message);
      }

      const text = readTranscriptText(body);
      if (!text) {
        throw new Error('OpenAI-sub transcription response did not include transcript text.');
      }

      const cost = options.pricing.estimateCost({
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
          billingMode: PROVIDER_BILLING_MODES[providerId],
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
