import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL,
  PROVIDER_BILLING_MODES,
} from '@toph/desktop-contracts';

import type { ProviderAuthService } from '../../auth/provider-auth-service';
import type { PricingService } from '../../pricing/pricing-service';
import type { AppSettingsStore } from '../../settings/app-settings-store';
import type { TranscriptionProvider, TranscriptionProviderResult } from '../transcription-provider';

const providerId = 'antigravity';
const endpoint = 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent';
const defaultProjectId = 'rising-fact-p41fc';
const tierSuffixRegex = /-(minimal|low|medium|high)$/i;

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

class TransientTranscriptionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientTranscriptionProviderError';
  }
}

function normalizeRequestedModel(model: string) {
  const trimmed = model.trim() || DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL;
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

function resolveAntigravityModel(model: string) {
  const normalized = normalizeRequestedModel(model);
  const { baseModel, tier } = extractTier(normalized);

  if (isGemini3Pro(baseModel)) {
    const proTier = tier === 'high' ? 'high' : 'low';
    return {
      actualModel: `${baseModel}-${proTier}`,
      thinkingLevel: proTier,
    };
  }

  if (isGemini3Flash(baseModel)) {
    return {
      actualModel: baseModel,
      thinkingLevel: tier ?? 'low',
    };
  }

  return {
    actualModel: normalized,
    thinkingLevel: tier,
  };
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

function isRetryableFailure(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

function buildPrompt(durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return [
    'Generate a clean, verbatim transcript of the speech in this audio clip.',
    'Return only the transcript text. Do not summarize, add timestamps, or describe the audio.',
    'Preserve spoken terminology, product names, acronyms, casing when obvious, and filler words only when they affect meaning.',
    `The clip is approximately ${seconds} seconds long.`,
  ].join('\n');
}

export function createAntigravityTranscriptionProvider(options: {
  auth: Pick<ProviderAuthService, 'resolveCredentials'>;
  pricing: Pick<PricingService, 'estimateCost'>;
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
}): TranscriptionProvider {
  return {
    id: providerId,

    async transcribeBatch(input): Promise<TranscriptionProviderResult> {
      const credentials = await options.auth.resolveCredentials(providerId);
      const requestedModel = options.settingsStore.getSettings().transcription.model;
      const resolvedModel = resolveAntigravityModel(requestedModel);
      const audio = await readFile(input.audioPath);
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
              parts: [
                { text: buildPrompt(input.durationMs) },
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: audio.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
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
        throw new TransientTranscriptionProviderError(
          `Antigravity transcription request failed: ${String(error)}`,
        );
      }

      const responseText = await response.text();
      if (!response.ok) {
        const message = `Antigravity transcription failed: HTTP ${response.status} ${responseText.slice(
          0,
          2000,
        )}`;
        if (isRetryableFailure(response.status)) {
          throw new TransientTranscriptionProviderError(message);
        }
        throw new Error(message);
      }

      let responseJson: unknown;
      try {
        responseJson = JSON.parse(responseText) as unknown;
      } catch (error) {
        throw new TransientTranscriptionProviderError(
          `Antigravity transcription returned invalid JSON: ${String(error)}`,
        );
      }

      const text = extractTextFromResponse(responseJson).trim();
      if (!text) {
        throw new TransientTranscriptionProviderError(
          `Antigravity transcription returned an empty transcript. Response: ${truncateResponseBody(
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
          audioDurationMs: input.durationMs,
          billableDurationMs: input.durationMs,
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
