import type { ProviderSettings } from '@toph/desktop-contracts';

import type { UsageCostEstimate } from '../../src/main/pricing/pricing-service.ts';
import type {
  ProviderClientContext,
  ProviderCredentials,
} from '../../src/main/providers/provider-definition.ts';

export interface RecordedRequest {
  url: string;
  init: RequestInit;
}

/**
 * Replaces `globalThis.fetch` for the duration of one test and records what the client sent. The
 * risk worth covering here is the request this app builds, not whether Node serialises it.
 */
export function stubFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const calls: RecordedRequest[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;

  return {
    calls,
    only() {
      if (calls.length !== 1) {
        throw new Error(`Expected exactly one request, saw ${calls.length}.`);
      }
      return calls[0];
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const noCostEstimate: UsageCostEstimate = {
  costUsdMicros: 0,
  costSource: 'none',
  pricingCatalogProviderId: null,
  pricingCatalogModelId: null,
};

export function createClientContext(options: {
  formValues: Record<string, string>;
  settings?: Partial<ProviderSettings>;
  estimate?: UsageCostEstimate;
}) {
  const pricingCalls: Parameters<ProviderClientContext['pricing']['estimateCost']>[0][] = [];
  const credentials: ProviderCredentials = {
    accessToken: '',
    accountId: null,
    formValues: options.formValues,
  };

  const context: ProviderClientContext = {
    credentials: async () => credentials,
    settings: () => ({
      provider: {},
      transcription: {},
      inference: {},
      ...options.settings,
    }),
    pricing: {
      estimateCost(input) {
        pricingCalls.push(input);
        return options.estimate ?? noCostEstimate;
      },
    },
    billingMode: 'metered',
  };

  return { context, pricingCalls };
}
