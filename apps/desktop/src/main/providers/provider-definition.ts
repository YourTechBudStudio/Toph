import type {
  ProviderBillingMode,
  ProviderFieldSpec,
  ProviderId,
  ProviderRole,
  ProviderSettings,
  ProviderSettingsGroup,
} from '@toph/desktop-contracts';

import type { PricingService } from '../pricing/pricing-service';
import type { ProviderUsageDetails } from '../provider-usage';

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
    audioPath: string;
    durationMs: number;
    model: string;
    signal?: AbortSignal;
  }) => Promise<TranscriptionClientResult>;
}

export interface InferenceClientResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
}

export interface InferenceClient {
  id: string;
  inferText: (input: {
    instructions: string;
    inputText: string;
    signal?: AbortSignal;
  }) => Promise<InferenceClientResult>;
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

export class TransientInferenceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientInferenceProviderError';
  }
}

export function isTransientInferenceProviderError(
  error: unknown,
): error is TransientInferenceProviderError {
  return error instanceof TransientInferenceProviderError;
}

/**
 * Resolved credentials for one provider. Flat rather than a union across the two credential kinds:
 * `formValues` is `{}` for OAuth providers and `accessToken` is `''` for form providers, which
 * keeps the request path of every client free of a discriminant it would only ever ignore.
 */
export interface ProviderCredentials {
  accessToken: string;
  accountId: string | null;
  formValues: Record<string, string>;
}

/**
 * What a client is handed at construction. Credentials and settings are read through functions so a
 * client created once at startup always sees current values.
 */
export interface ProviderClientContext {
  credentials: () => Promise<ProviderCredentials>;
  /** This provider's materialised settings groups. */
  settings: () => ProviderSettings;
  pricing: Pick<PricingService, 'estimateCost'>;
  billingMode: ProviderBillingMode;
}

export interface OAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface PendingOAuthFlow {
  authorizationUrl: string;
  exchangeAuthorizationInput: (input: string) => Promise<OAuthTokens>;
  waitForCallback: () => Promise<OAuthTokens>;
  dispose: () => Promise<void>;
}

export interface OAuthAuthStrategy {
  kind: 'oauth';
  createFlow: () => Promise<PendingOAuthFlow>;
  refresh: (refreshToken: string) => Promise<OAuthTokens>;
}

export interface FormAuthStrategy {
  kind: 'form';
  fields: ProviderFieldSpec[];
  /**
   * Verifies and canonicalises the connection values. Rejects when the values cannot be used, and
   * nothing is stored when it throws. Returning `values` replaces the stored map wholesale, so a
   * provider that rewrites one field returns the full declared key set; omitting it stores the
   * values as submitted. This exists so the value stored, the value published in
   * `connectionSummary` and the value the clients actually call are always the same string.
   */
  verify: (values: Record<string, string>) => Promise<{
    accountId: string | null;
    values?: Record<string, string>;
  }>;
}

export type ProviderAuthStrategy = OAuthAuthStrategy | FormAuthStrategy;

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  description: string;
  billingMode: ProviderBillingMode;
  roles: readonly ProviderRole[];
  auth: ProviderAuthStrategy;
  settingsFields: Record<ProviderSettingsGroup, ProviderFieldSpec[]>;
  createTranscriptionClient?: (context: ProviderClientContext) => TranscriptionClient;
  createInferenceClient?: (context: ProviderClientContext) => InferenceClient;
}
