import {
  TransientInferenceProviderError,
  type InferenceClient,
  type InferenceClientResult,
  type ProviderClientContext,
} from '../provider-definition';
import {
  endpointFromCredentials,
  isOfficialOpenAiEndpoint,
  isRetryableStatus,
  readRequestId,
  readResponseBody,
} from './http';

const providerId = 'openai';

interface TokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * One polishing call expressed against whichever OpenAI API the `api` setting selected. The two
 * APIs differ in their path, request body and the shape of both the text and the usage they return,
 * and in nothing else, so the client holds one request path and swaps this.
 */
interface InferenceCall {
  path: string;
  body: unknown;
  readText: (body: unknown) => string;
  readUsage: (body: unknown) => TokenCounts | null;
}

interface CallInput {
  model: string;
  reasoningEffort: string;
  instructions: string;
  inputText: string;
}

function readNumber(value: unknown) {
  return typeof value === 'number' ? value : 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function buildChatCall(input: CallInput): InferenceCall {
  return {
    path: '/chat/completions',
    body: {
      model: input.model,
      messages: [
        { role: 'system', content: input.instructions },
        { role: 'user', content: input.inputText },
      ],
      stream: false,
      // An empty reasoning effort means "let the model decide": omit the parameter entirely.
      ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
    },

    readText(body) {
      const choices = asObject(body)?.choices;
      if (!Array.isArray(choices)) {
        return '';
      }

      const content = asObject(asObject(choices[0])?.message)?.content;
      return typeof content === 'string' ? content : '';
    },

    readUsage(body) {
      const usage = asObject(asObject(body)?.usage);
      if (!usage) {
        return null;
      }

      return {
        inputTokens: readNumber(usage.prompt_tokens),
        cachedInputTokens: readNumber(asObject(usage.prompt_tokens_details)?.cached_tokens),
        outputTokens: readNumber(usage.completion_tokens),
      };
    },
  };
}

function buildResponsesCall(input: CallInput): InferenceCall {
  return {
    path: '/responses',
    body: {
      model: input.model,
      instructions: input.instructions,
      input: input.inputText,
      store: false,
      stream: false,
      ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
    },

    readText(body) {
      const response = asObject(body);
      // `output_text` is an SDK convenience that the raw HTTP payload does not carry, so the
      // `output` walk below is the path that actually runs against OpenAI. It is still read first
      // because compatible servers are free to include it.
      if (typeof response?.output_text === 'string') {
        return response.output_text;
      }
      if (!Array.isArray(response?.output)) {
        return '';
      }

      const parts: string[] = [];
      for (const item of response.output) {
        const content = asObject(item)?.content;
        if (!Array.isArray(content)) {
          continue;
        }
        for (const part of content) {
          const candidate = asObject(part);
          if (candidate?.type === 'output_text' && typeof candidate.text === 'string') {
            parts.push(candidate.text);
          }
        }
      }
      return parts.join('');
    },

    readUsage(body) {
      const usage = asObject(asObject(body)?.usage);
      if (!usage) {
        return null;
      }

      return {
        inputTokens: readNumber(usage.input_tokens),
        cachedInputTokens: readNumber(asObject(usage.input_tokens_details)?.cached_tokens),
        outputTokens: readNumber(usage.output_tokens),
      };
    },
  };
}

export function createOpenAiInferenceClient(context: ProviderClientContext): InferenceClient {
  return {
    id: providerId,

    async inferText(input): Promise<InferenceClientResult> {
      const credentials = await context.credentials();
      const { baseUrl, apiKey } = endpointFromCredentials(credentials.formValues);
      const settings = context.settings().inference;
      const model = String(settings.model ?? '');
      const callInput: CallInput = {
        model,
        reasoningEffort: String(settings.reasoningEffort ?? ''),
        instructions: input.instructions,
        inputText: input.inputText,
      };
      const call =
        String(settings.api ?? 'chat') === 'responses'
          ? buildResponsesCall(callInput)
          : buildChatCall(callInput);

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${call.path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(call.body),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientInferenceProviderError(
          `OpenAI inference request failed: ${String(error)}`,
        );
      }

      const requestId = readRequestId(response);
      const body = await readResponseBody(response);

      if (!response.ok) {
        const message = `OpenAI inference failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 2000)}`;
        if (isRetryableStatus(response.status)) {
          throw new TransientInferenceProviderError(message);
        }
        throw new Error(message);
      }

      // A body read that failed mid-stream is a transport fault. Already transient by way of the
      // empty-output check below, but named here so the message says what actually happened.
      if (body === null) {
        throw new TransientInferenceProviderError(
          'OpenAI inference response body could not be read.',
        );
      }

      const text = call.readText(body).trim();
      if (!text) {
        throw new TransientInferenceProviderError('OpenAI inference returned an empty output.');
      }

      const usage = call.readUsage(body);
      const cost = usage
        ? context.pricing.estimateCost({
            providerId,
            model,
            usage: {
              kind: 'tokens',
              ...usage,
            },
            allowStaticFallback: isOfficialOpenAiEndpoint(baseUrl),
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
          billingMode: context.billingMode,
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
        providerResponseJson: body,
      };
    },
  };
}
