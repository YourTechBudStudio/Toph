import { PROVIDER_BILLING_MODES } from '@toph/desktop-contracts';

import type { ProviderAuthService } from '../../auth/provider-auth-service';
import type { PricingService } from '../../pricing/pricing-service';
import type { AppSettingsStore } from '../../settings/app-settings-store';
import {
  TransientInferenceProviderError,
  UnsupportedInferenceImageInputError,
  type InferenceProvider,
  type InferenceProviderResult,
} from '../inference-provider';
import {
  createOpenAiSubResponsesPayload,
  readOpenAiSubImageInput,
} from './openai-sub-payload';

const providerId = 'openai-sub';
const endpoint = 'https://chatgpt.com/backend-api/codex/responses';

function isRetryableFailure(status: number, body: string) {
  if (status === 403 && /<html|<meta\s+http-equiv=/i.test(body)) {
    return true;
  }

  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isImageInputRejection(status: number, body: string) {
  return (
    status === 400 &&
    /(?:image|input_image|multimodal|vision).*(?:unsupported|invalid|not supported)|(?:unsupported|invalid).*(?:image|input_image|multimodal|vision)/i.test(
      body,
    )
  );
}

function parseSseEvents(text: string) {
  const events: unknown[] = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      continue;
    }

    try {
      events.push(JSON.parse(data));
    } catch {
      // Keep later events useful even if one event is malformed.
    }
  }
  return events;
}

function extractTextFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const candidate = item as {
      type?: unknown;
      text?: unknown;
      output_text?: unknown;
    };
    if (typeof candidate.text === 'string') {
      parts.push(candidate.text);
    }
    if (typeof candidate.output_text === 'string') {
      parts.push(candidate.output_text);
    }
  }
  return parts;
}

function extractTextFromCompletedResponse(event: unknown) {
  if (typeof event !== 'object' || event === null) {
    return '';
  }

  const response = (event as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) {
    return '';
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return '';
  }

  return output
    .flatMap((item) => extractTextFromContent((item as { content?: unknown })?.content))
    .join('');
}

function extractText(events: unknown[]) {
  const deltaParts: string[] = [];
  const completedTextParts: string[] = [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) {
      continue;
    }

    const candidate = event as {
      delta?: unknown;
      text?: unknown;
      output_text?: unknown;
      type?: unknown;
    };
    if (candidate.type === 'response.output_text.delta' && typeof candidate.delta === 'string') {
      deltaParts.push(candidate.delta);
    }
    if (candidate.type === 'response.output_text.done' && typeof candidate.text === 'string') {
      completedTextParts.push(candidate.text);
    }
    if (candidate.type === 'response.completed' && typeof candidate.output_text === 'string') {
      completedTextParts.push(candidate.output_text);
    }
  }

  const streamed = deltaParts.join('') || completedTextParts.join('');
  if (streamed) {
    return streamed;
  }

  for (const event of events) {
    const completed = extractTextFromCompletedResponse(event);
    if (completed) {
      return completed;
    }
  }

  return '';
}

function extractTokenUsage(events: unknown[]) {
  for (const event of [...events].reverse()) {
    if (typeof event !== 'object' || event === null) {
      continue;
    }
    const response = (event as { response?: unknown }).response;
    if (typeof response !== 'object' || response === null) {
      continue;
    }
    const usage = (response as { usage?: unknown }).usage;
    if (typeof usage !== 'object' || usage === null) {
      continue;
    }

    const candidate = usage as {
      input_tokens?: unknown;
      input_tokens_details?: { cached_tokens?: unknown };
      output_tokens?: unknown;
    };
    return {
      inputTokens: typeof candidate.input_tokens === 'number' ? candidate.input_tokens : 0,
      cachedInputTokens:
        typeof candidate.input_tokens_details?.cached_tokens === 'number'
          ? candidate.input_tokens_details.cached_tokens
          : 0,
      outputTokens: typeof candidate.output_tokens === 'number' ? candidate.output_tokens : 0,
    };
  }

  return null;
}

export function createOpenAiSubInferenceProvider(options: {
  auth: Pick<ProviderAuthService, 'resolveCredentials'>;
  pricing: Pick<PricingService, 'estimateCost'>;
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
}): InferenceProvider {
  return {
    id: providerId,

    async inferText(input): Promise<InferenceProviderResult> {
      const credentials = await options.auth.resolveCredentials(providerId);
      const model = options.settingsStore.getSettings().inference.model;
      let imageInputs: Awaited<ReturnType<typeof readOpenAiSubImageInput>>[];
      try {
        imageInputs = await Promise.all((input.images ?? []).map(readOpenAiSubImageInput));
      } catch (error) {
        throw new UnsupportedInferenceImageInputError(
          `OpenAI-sub image input could not be prepared: ${String(error)}`,
        );
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        originator: 'opencode',
        'User-Agent': 'Toph (openai-sub inference)',
      };
      if (credentials.accountId) {
        headers['ChatGPT-Account-ID'] = credentials.accountId;
      }

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            createOpenAiSubResponsesPayload({
              model,
              instructions: input.instructions,
              inputText: input.inputText,
              imageInputs,
            }),
          ),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientInferenceProviderError(
          `OpenAI-sub inference request failed: ${String(error)}`,
        );
      }

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
      const body = await response.text();
      if (!response.ok) {
        const message = `OpenAI-sub inference failed: HTTP ${response.status} ${body.slice(0, 2000)}`;
        if (imageInputs.length > 0 && isImageInputRejection(response.status, body)) {
          throw new UnsupportedInferenceImageInputError(message);
        }
        if (isRetryableFailure(response.status, body)) {
          throw new TransientInferenceProviderError(message);
        }
        throw new Error(message);
      }

      const events = parseSseEvents(body);
      const text = extractText(events).trim();
      if (!text) {
        throw new TransientInferenceProviderError('OpenAI-sub inference returned an empty output.');
      }

      const usage = extractTokenUsage(events);
      const cost = usage
        ? options.pricing.estimateCost({
            providerId,
            model,
            usage: {
              kind: 'tokens',
              ...usage,
            },
          })
        : {
            costUsdMicros: 0,
            costSource: 'none' as const,
            pricingCatalogProviderId: null,
            pricingCatalogModelId: null,
          };

      return {
        text,
        provider: providerId,
        model,
        usage: {
          billingMode: PROVIDER_BILLING_MODES[providerId],
          audioDurationMs: null,
          billableDurationMs: null,
          inputTokens: usage?.inputTokens ?? null,
          cachedInputTokens: usage?.cachedInputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          estimatedCostUsdMicros: cost.costUsdMicros,
          costSource: cost.costSource,
          pricingCatalogProviderId: cost.pricingCatalogProviderId,
          pricingCatalogModelId: cost.pricingCatalogModelId,
        },
        providerRequestId: requestId,
        providerResponseJson: events,
      };
    },
  };
}
