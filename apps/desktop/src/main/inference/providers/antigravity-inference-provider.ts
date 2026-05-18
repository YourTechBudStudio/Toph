import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_ANTIGRAVITY_INFERENCE_MODEL,
  PROVIDER_BILLING_MODES,
} from '@toph/desktop-contracts';

import type { ProviderAuthService } from '../../auth/provider-auth-service';
import type { PricingService } from '../../pricing/pricing-service';
import type { AppSettingsStore } from '../../settings/app-settings-store';
import type {
  InferenceImageInput,
  InferenceProvider,
  InferenceProviderResult,
} from '../inference-provider';

const providerId = 'antigravity';
const endpoint = 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent';
const defaultProjectId = 'rising-fact-p41fc';
const tierSuffixRegex = /-(minimal|low|medium|high)$/i;

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

class TransientInferenceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientInferenceProviderError';
  }
}

class UnsupportedInferenceImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedInferenceImageInputError';
  }
}

export interface ResolvedAntigravityModel {
  requestedModel: string;
  actualModel: string;
  thinkingLevel?: ThinkingLevel;
}

function antigravityHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.18.3 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"${
      process.platform === 'win32' ? 'WINDOWS' : 'MACOS'
    }","pluginType":"GEMINI"}`,
  };
}

function normalizeRequestedModel(model: string) {
  const trimmed = model.trim() || DEFAULT_ANTIGRAVITY_INFERENCE_MODEL;
  return trimmed
    .replace(/^antigravity-/i, '')
    .replace(/-preview-customtools$/i, '')
    .replace(/-preview$/i, '');
}

function extractTier(model: string) {
  const match = model.match(tierSuffixRegex);
  if (!match) {
    return { baseModel: model, tier: undefined };
  }

  return {
    baseModel: model.replace(tierSuffixRegex, ''),
    tier: match[1].toLowerCase() as ThinkingLevel,
  };
}

function isGemini3Pro(model: string) {
  return /^gemini-3(?:\.\d+)?-pro$/i.test(model);
}

function isGemini3Flash(model: string) {
  return /^gemini-3(?:\.\d+)?-flash(?:-lite)?$/i.test(model);
}

export function resolveAntigravityModel(model: string): ResolvedAntigravityModel {
  const normalized = normalizeRequestedModel(model);
  const { baseModel, tier } = extractTier(normalized);

  if (isGemini3Pro(baseModel)) {
    const proTier = tier === 'high' ? 'high' : 'low';
    return {
      requestedModel: model,
      actualModel: `${baseModel}-${proTier}`,
      thinkingLevel: proTier,
    };
  }

  if (isGemini3Flash(baseModel)) {
    return {
      requestedModel: model,
      actualModel: baseModel,
      thinkingLevel: tier ?? 'low',
    };
  }

  return {
    requestedModel: model,
    actualModel: normalized,
    thinkingLevel: tier,
  };
}

function isRetryableFailure(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isImageInputRejection(status: number, body: string) {
  return (
    (status === 400 || status === 403) &&
    /(?:image|inlineData|multimodal|vision).*(?:unsupported|invalid|not supported|permission)|(?:unsupported|invalid|not supported).*(?:image|inlineData|multimodal|vision)/i.test(
      body,
    )
  );
}

function unwrapResponsePayload(json: unknown) {
  if (typeof json !== 'object' || json === null) {
    return json;
  }

  const response = (json as { response?: unknown }).response;
  if (typeof response === 'object' && response !== null) {
    return response;
  }

  return json;
}

function truncateResponseBody(responseText: string) {
  const compact = responseText.replace(/\s+/g, ' ').trim();
  return compact.length > 2000 ? `${compact.slice(0, 2000)}...` : compact;
}

async function readImageInput(image: InferenceImageInput) {
  const bytes = await readFile(image.path);
  return {
    inlineData: {
      mimeType: image.mimeType,
      data: bytes.toString('base64'),
    },
  };
}

function extractTextFromResponse(json: unknown) {
  const payload = unwrapResponsePayload(json);
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    return '';
  }

  const parts: string[] = [];
  for (const candidate of candidates) {
    const content = (candidate as { content?: { parts?: unknown } } | null)?.content;
    if (!content || !Array.isArray(content.parts)) {
      continue;
    }

    for (const part of content.parts) {
      const partRecord = part as { text?: unknown; thought?: unknown } | null;
      if (
        partRecord &&
        partRecord.thought !== true &&
        typeof partRecord.text === 'string' &&
        partRecord.text
      ) {
        parts.push(partRecord.text);
      }
    }
  }

  return parts.join('');
}

function extractTokenUsage(json: unknown) {
  const payload = unwrapResponsePayload(json);
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const usage = (payload as { usageMetadata?: unknown }).usageMetadata;
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const candidate = usage as {
    promptTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
    candidatesTokenCount?: unknown;
  };
  return {
    inputTokens: typeof candidate.promptTokenCount === 'number' ? candidate.promptTokenCount : 0,
    cachedInputTokens:
      typeof candidate.cachedContentTokenCount === 'number' ? candidate.cachedContentTokenCount : 0,
    outputTokens:
      typeof candidate.candidatesTokenCount === 'number' ? candidate.candidatesTokenCount : 0,
  };
}

export function createAntigravityInferenceProvider(options: {
  auth: Pick<ProviderAuthService, 'resolveCredentials'>;
  pricing: Pick<PricingService, 'estimateCost'>;
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
}): InferenceProvider {
  return {
    id: providerId,

    async inferText(input): Promise<InferenceProviderResult> {
      const credentials = await options.auth.resolveCredentials(providerId);
      const requestedModel = options.settingsStore.getSettings().inference.model;
      const resolvedModel = resolveAntigravityModel(requestedModel);
      let imageInputs: Awaited<ReturnType<typeof readImageInput>>[];
      try {
        imageInputs = await Promise.all((input.images ?? []).map(readImageInput));
      } catch (error) {
        throw new UnsupportedInferenceImageInputError(
          `Antigravity image input could not be prepared: ${String(error)}`,
        );
      }

      const thinkingConfig = resolvedModel.thinkingLevel
        ? {
            includeThoughts: false,
            thinkingLevel: resolvedModel.thinkingLevel,
          }
        : undefined;
      const requestId = `agent-${randomUUID()}`;
      const payload = {
        project: credentials.projectId ?? defaultProjectId,
        model: resolvedModel.actualModel,
        request: {
          contents: [
            {
              role: 'user',
              parts: [{ text: input.inputText }, ...imageInputs],
            },
          ],
          systemInstruction: {
            role: 'user',
            parts: [{ text: input.instructions }],
          },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        },
        requestType: 'agent',
        userAgent: 'antigravity',
        requestId,
      };

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json',
            ...antigravityHeaders(),
          },
          body: JSON.stringify(payload),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new TransientInferenceProviderError(
          `Antigravity inference request failed: ${String(error)}`,
        );
      }

      const responseText = await response.text();
      if (!response.ok) {
        const message = `Antigravity inference failed: HTTP ${response.status} ${responseText.slice(
          0,
          2000,
        )}`;
        if (imageInputs.length > 0 && isImageInputRejection(response.status, responseText)) {
          throw new UnsupportedInferenceImageInputError(message);
        }
        if (isRetryableFailure(response.status)) {
          throw new TransientInferenceProviderError(message);
        }
        throw new Error(message);
      }

      let responseJson: unknown;
      try {
        responseJson = JSON.parse(responseText) as unknown;
      } catch (error) {
        throw new TransientInferenceProviderError(
          `Antigravity inference returned invalid JSON: ${String(error)}`,
        );
      }

      const text = extractTextFromResponse(responseJson).trim();
      if (!text) {
        throw new TransientInferenceProviderError(
          `Antigravity inference returned an empty output. Response: ${truncateResponseBody(
            responseText,
          )}`,
        );
      }

      const usage = extractTokenUsage(responseJson);
      const cost = usage
        ? options.pricing.estimateCost({
            providerId,
            model: resolvedModel.actualModel,
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
        model: resolvedModel.actualModel,
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
        providerRequestId:
          response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? requestId,
        providerResponseJson: responseJson,
      };
    },
  };
}
