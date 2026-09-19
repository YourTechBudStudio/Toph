import {
  applyProviderFieldDefaults,
  type ProviderConnection,
  type ProviderConnectionStatus,
  type ProviderFieldSpec,
  type ProviderId,
  type ProviderSettings,
  type ProviderState,
} from '@toph/desktop-contracts';

import type { PricingService } from '../pricing/pricing-service';
import type { AppSettingsStore } from '../settings/app-settings-store';
import {
  readProviderCredentialStorage,
  updateProviderCredential,
  type FormCredential,
  type OAuthCredential,
  type ProviderCredential,
  type ProviderCredentialStorage,
} from './credential-storage';
import type {
  InferenceClient,
  OAuthTokens,
  PendingOAuthFlow,
  ProviderCredentials,
  ProviderDefinition,
  TranscriptionClient,
} from './provider-definition';
import type { ProviderRegistry } from './provider-registry';

const expirySkewMs = 60_000;

export interface ProviderRouting {
  /** `providerId` is `null` while the role has no provider chosen. */
  transcription: { providerId: ProviderId | null; model: string };
  inference: { providerId: ProviderId | null; model: string };
}

export interface ProviderService {
  getState: () => Promise<ProviderState>;
  /** The provider and model each role currently resolves to, from settings. */
  getRouting: () => ProviderRouting;
  resolveCredentials: (providerId: ProviderId) => Promise<ProviderCredentials>;
  /** Takes a plain string because session rows carry an untyped recorded provider id. */
  resolveTranscriptionClient: (providerId: string) => TranscriptionClient | null;
  resolveInferenceClient: () => InferenceClient;
  connectProvider: (
    providerId: ProviderId,
    input?: Record<string, string>,
  ) => Promise<ProviderState>;
  submitProviderAuthorization: (providerId: ProviderId, input: string) => Promise<ProviderState>;
  removeProvider: (providerId: ProviderId) => Promise<ProviderState>;
  refreshProviders: () => Promise<ProviderState>;
  dispose: () => Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

interface ProviderRuntime {
  definition: ProviderDefinition;
  transcription: TranscriptionClient | null;
  inference: InferenceClient | null;
  pendingFlow: PendingOAuthFlow | null;
  pendingFlowSettled: boolean;
  lastError: string | null;
}

function toOAuthCredential(tokens: OAuthTokens): OAuthCredential {
  return {
    type: 'oauth',
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    accountId: tokens.accountId,
  };
}

/**
 * A credential of the wrong kind for the provider's current auth strategy is treated as absent:
 * it can only come from a definition that changed kind under a stored file, and reconnecting is the
 * only way forward either way.
 */
function credentialForStrategy(
  definition: ProviderDefinition,
  credential: ProviderCredential | undefined,
): ProviderCredential | null {
  if (!credential || credential.type !== definition.auth.kind) {
    return null;
  }
  return credential;
}

function connectionSummary(fields: ProviderFieldSpec[], credential: FormCredential | null) {
  if (!credential) {
    return {};
  }

  const summary: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === 'text' && field.secret === true) {
      continue;
    }
    const value = credential.values[field.key];
    if (typeof value === 'string' && value.length > 0) {
      summary[field.key] = value;
    }
  }
  return summary;
}

function toStatus(options: {
  credential: ProviderCredential | null;
  connecting: boolean;
  error: string | null;
}): ProviderConnectionStatus {
  if (options.connecting) {
    return 'connecting';
  }
  if (options.credential) {
    return 'connected';
  }
  return options.error ? 'invalid' : 'missing';
}

export function createProviderService(options: {
  registry: ProviderRegistry;
  credentialsPath: string;
  settingsStore: Pick<
    AppSettingsStore,
    'getSettings' | 'subscribe' | 'setTranscriptionProvider' | 'setInferenceProvider'
  >;
  pricing: Pick<PricingService, 'estimateCost'>;
  openExternal: (url: string) => Promise<void>;
  onStateChanged?: (state: ProviderState) => void;
}): ProviderService {
  const emptySettings = (): ProviderSettings => ({
    provider: {},
    transcription: {},
    inference: {},
  });

  const providerSettings = (id: ProviderId): ProviderSettings =>
    options.settingsStore.getSettings().providers[id] ?? emptySettings();

  const readStorage = () => readProviderCredentialStorage(options.credentialsPath);

  const readCredential = async (definition: ProviderDefinition) =>
    credentialForStrategy(definition, (await readStorage())[definition.id]);

  const runtimes = new Map<ProviderId, ProviderRuntime>();
  for (const definition of options.registry.list()) {
    const context = {
      credentials: () => service.resolveCredentials(definition.id),
      settings: () => providerSettings(definition.id),
      pricing: options.pricing,
      billingMode: definition.billingMode,
    };
    runtimes.set(definition.id, {
      definition,
      transcription: definition.createTranscriptionClient?.(context) ?? null,
      inference: definition.createInferenceClient?.(context) ?? null,
      pendingFlow: null,
      pendingFlowSettled: true,
      lastError: null,
    });
  }

  const requireRuntime = (id: ProviderId) => {
    const runtime = runtimes.get(id);
    if (!runtime) {
      throw new ProviderError('Unknown provider.');
    }
    return runtime;
  };

  const storeCredential = async (runtime: ProviderRuntime, credential: ProviderCredential) => {
    await updateProviderCredential(options.credentialsPath, runtime.definition.id, credential);
    runtime.lastError = null;
  };

  const clearCredential = async (runtime: ProviderRuntime) => {
    await updateProviderCredential(options.credentialsPath, runtime.definition.id, null);
  };

  /**
   * A provider the user just connected takes every role nobody has chosen yet, and never overrides
   * a choice already made. Called from the connect paths only — never from a token refresh, which
   * must not change routing behind the user's back — so connecting from Settings and from
   * onboarding route identically (supersedes D14's UI-side routing).
   */
  const claimUnsetRoles = async (definition: ProviderDefinition) => {
    const settings = options.settingsStore.getSettings();
    if (definition.roles.includes('transcription') && settings.transcription.providerId === null) {
      await options.settingsStore.setTranscriptionProvider(definition.id);
    }
    if (definition.roles.includes('inference') && settings.inference.providerId === null) {
      await options.settingsStore.setInferenceProvider(definition.id);
    }
  };

  /**
   * Only an explicit removal unroutes: a credential cleared because a refresh failed leaves the
   * choice alone, so reconnecting restores the setup the user already had.
   */
  const releaseRoles = async (providerId: ProviderId) => {
    const settings = options.settingsStore.getSettings();
    if (settings.transcription.providerId === providerId) {
      await options.settingsStore.setTranscriptionProvider(null);
    }
    if (settings.inference.providerId === providerId) {
      await options.settingsStore.setInferenceProvider(null);
    }
  };

  const refreshOAuthCredential = async (runtime: ProviderRuntime, credential: OAuthCredential) => {
    if (runtime.definition.auth.kind !== 'oauth') {
      throw new ProviderError('Provider does not use OAuth.');
    }

    const refreshed = toOAuthCredential(await runtime.definition.auth.refresh(credential.refresh));
    return {
      ...refreshed,
      accountId: refreshed.accountId ?? credential.accountId,
    };
  };

  /**
   * Takes the credential from a caller-owned read so refreshing every provider costs one read of
   * the credentials file rather than one per provider.
   */
  const refreshCredentialIfExpired = async (
    runtime: ProviderRuntime,
    credential: ProviderCredential | null,
  ) => {
    if (
      !credential ||
      credential.type !== 'oauth' ||
      credential.expires > Date.now() + expirySkewMs
    ) {
      return;
    }

    try {
      await storeCredential(runtime, await refreshOAuthCredential(runtime, credential));
    } catch (error) {
      runtime.lastError =
        error instanceof Error ? error.message : 'Provider credentials could not be refreshed.';
      await clearCredential(runtime);
    }
  };

  const toConnection = (
    runtime: ProviderRuntime,
    storage: ProviderCredentialStorage,
  ): ProviderConnection => {
    const { definition } = runtime;
    const credential = credentialForStrategy(definition, storage[definition.id]);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      billingMode: definition.billingMode,
      roles: [...definition.roles],
      auth:
        definition.auth.kind === 'oauth'
          ? { kind: 'oauth' }
          : { kind: 'form', fields: definition.auth.fields },
      settingsFields: definition.settingsFields,
      status: toStatus({
        credential,
        connecting: runtime.pendingFlow !== null,
        error: runtime.lastError,
      }),
      accountId: credential?.accountId ?? null,
      expires: credential?.type === 'oauth' ? credential.expires : null,
      error: runtime.lastError,
      connectionSummary:
        definition.auth.kind === 'form'
          ? connectionSummary(
              definition.auth.fields,
              credential?.type === 'form' ? credential : null,
            )
          : {},
    };
  };

  /**
   * One read of the credentials file per state build, so every provider in a published snapshot is
   * described from the same view of disk rather than from interleaved reads.
   */
  const buildState = async (): Promise<ProviderState> => {
    const storage = await readStorage();
    const providers = Array.from(runtimes.values(), (runtime) => toConnection(runtime, storage));

    const routing = service.getRouting();
    const isConnected = (id: ProviderId | null) =>
      id !== null &&
      providers.some((provider) => provider.id === id && provider.status === 'connected');

    return {
      // Readiness is against routing alone: both roles must name a connected provider, with no
      // exemption for polishing being switched off. An unrouted role is not ready.
      ready:
        isConnected(routing.transcription.providerId) && isConnected(routing.inference.providerId),
      providers,
    };
  };

  /** Returns the state it published, so a caller never has to build it a second time. */
  const publishState = async () => {
    const state = await buildState();
    options.onStateChanged?.(state);
    return state;
  };

  const runPendingLogin = async (runtime: ProviderRuntime, flow: PendingOAuthFlow) => {
    try {
      await storeCredential(runtime, toOAuthCredential(await flow.waitForCallback()));
      await claimUnsetRoles(runtime.definition);
    } catch (error) {
      if (await readCredential(runtime.definition)) {
        return;
      }
      runtime.lastError = error instanceof Error ? error.message : 'Provider login failed.';
      throw error;
    } finally {
      if (runtime.pendingFlow === flow) {
        runtime.pendingFlow = null;
        runtime.pendingFlowSettled = true;
      }
      await flow.dispose().catch(() => {});
      await publishState();
    }
  };

  const connectOAuthProvider = async (runtime: ProviderRuntime) => {
    if (runtime.definition.auth.kind !== 'oauth') {
      throw new ProviderError('Provider does not use OAuth.');
    }
    if (runtime.pendingFlow && !runtime.pendingFlowSettled) {
      return buildState();
    }

    runtime.lastError = null;
    runtime.pendingFlowSettled = false;
    try {
      runtime.pendingFlow = await runtime.definition.auth.createFlow();
    } catch (error) {
      runtime.lastError =
        error instanceof Error ? error.message : 'Provider login could not start.';
      runtime.pendingFlow = null;
      runtime.pendingFlowSettled = true;
      await publishState();
      throw error;
    }
    const flow = runtime.pendingFlow;
    await publishState();
    try {
      await options.openExternal(flow.authorizationUrl);
    } catch (error) {
      runtime.lastError =
        error instanceof Error ? error.message : 'Provider login could not open the browser.';
      runtime.pendingFlow = null;
      runtime.pendingFlowSettled = true;
      await flow.dispose().catch(() => {});
      await publishState();
      throw error;
    }
    await runPendingLogin(runtime, flow);
    return buildState();
  };

  const connectFormProvider = async (
    runtime: ProviderRuntime,
    input: Record<string, string> | undefined,
  ) => {
    if (runtime.definition.auth.kind !== 'form') {
      throw new ProviderError('Provider does not use a connection form.');
    }

    const { fields, verify } = runtime.definition.auth;
    const normalized = applyProviderFieldDefaults(fields, input);
    const values: Record<string, string> = {};
    for (const field of fields) {
      // The registry rejects a non-text connection field, so every value here is a string.
      const value = normalized[field.key];
      values[field.key] = typeof value === 'string' ? value : '';
      if (field.kind === 'text' && field.required === true && values[field.key].length === 0) {
        runtime.lastError = `${field.label} is required.`;
        await publishState();
        throw new ProviderError(runtime.lastError);
      }
    }

    let verified: { accountId: string | null; values?: Record<string, string> };
    try {
      verified = await verify(values);
    } catch (error) {
      runtime.lastError =
        error instanceof Error ? error.message : 'Provider could not be verified.';
      await publishState();
      throw error;
    }

    await storeCredential(runtime, {
      type: 'form',
      // `verify` may canonicalise what it was given; the returned map replaces the submitted one
      // wholesale, so what is stored is what was actually proven to work.
      values: verified.values ?? values,
      ...(verified.accountId ? { accountId: verified.accountId } : {}),
    });
    await claimUnsetRoles(runtime.definition);
    return publishState();
  };

  const service: ProviderService = {
    async getState() {
      const storage = await readStorage();
      for (const runtime of runtimes.values()) {
        await refreshCredentialIfExpired(
          runtime,
          credentialForStrategy(runtime.definition, storage[runtime.definition.id]),
        );
      }
      return buildState();
    },

    getRouting() {
      const settings = options.settingsStore.getSettings();
      const modelFor = (providerId: ProviderId | null, role: 'transcription' | 'inference') => {
        if (providerId === null) {
          return '';
        }
        const value = providerSettings(providerId)[role].model;
        return typeof value === 'string' ? value : '';
      };
      return {
        transcription: {
          providerId: settings.transcription.providerId,
          model: modelFor(settings.transcription.providerId, 'transcription'),
        },
        inference: {
          providerId: settings.inference.providerId,
          model: modelFor(settings.inference.providerId, 'inference'),
        },
      };
    },

    async resolveCredentials(id) {
      const runtime = requireRuntime(id);
      let credential = await readCredential(runtime.definition);
      if (!credential) {
        throw new ProviderError(
          `Connect the ${runtime.definition.label} provider before dictating.`,
        );
      }

      if (credential.type === 'form') {
        return {
          accessToken: '',
          accountId: credential.accountId ?? null,
          formValues: credential.values,
        };
      }

      if (credential.expires <= Date.now() + expirySkewMs) {
        try {
          credential = await refreshOAuthCredential(runtime, credential);
          await storeCredential(runtime, credential);
        } catch (error) {
          runtime.lastError =
            error instanceof Error ? error.message : 'Provider credentials could not be refreshed.';
          await clearCredential(runtime);
          await publishState();
          throw new ProviderError(
            'Provider credentials expired. Reconnect the provider to continue.',
          );
        }
      }

      return {
        accessToken: credential.access,
        accountId: credential.accountId ?? null,
        formValues: {},
      };
    },

    resolveTranscriptionClient(providerId) {
      return runtimes.get(providerId as ProviderId)?.transcription ?? null;
    },

    resolveInferenceClient() {
      const { providerId } = service.getRouting().inference;
      const client = providerId === null ? null : runtimes.get(providerId)?.inference;
      if (!client) {
        throw new ProviderError('Choose a polishing provider before dictating.');
      }
      return client;
    },

    async connectProvider(id, input) {
      const runtime = requireRuntime(id);
      return runtime.definition.auth.kind === 'oauth'
        ? connectOAuthProvider(runtime)
        : connectFormProvider(runtime, input);
    },

    async submitProviderAuthorization(id, input) {
      const runtime = requireRuntime(id);
      if (!runtime.pendingFlow) {
        throw new ProviderError('No provider login is waiting for an authorization code.');
      }

      try {
        const flow = runtime.pendingFlow;
        const tokens = await flow.exchangeAuthorizationInput(input);
        await storeCredential(runtime, toOAuthCredential(tokens));
        await claimUnsetRoles(runtime.definition);
        runtime.pendingFlow = null;
        runtime.pendingFlowSettled = true;
        await flow.dispose().catch(() => {});
        return publishState();
      } catch (error) {
        runtime.lastError = error instanceof Error ? error.message : 'Provider login failed.';
        await publishState();
        throw error;
      }
    },

    async removeProvider(id) {
      const runtime = requireRuntime(id);
      if (runtime.pendingFlow) {
        await runtime.pendingFlow.dispose().catch(() => {});
        runtime.pendingFlow = null;
        runtime.pendingFlowSettled = true;
      }
      runtime.lastError = null;
      await clearCredential(runtime);
      await releaseRoles(runtime.definition.id);
      return publishState();
    },

    async refreshProviders() {
      const storage = await readStorage();
      for (const runtime of runtimes.values()) {
        runtime.lastError = null;
        await refreshCredentialIfExpired(
          runtime,
          credentialForStrategy(runtime.definition, storage[runtime.definition.id]),
        );
      }
      return publishState();
    },

    async dispose() {
      unsubscribeSettings();
      for (const runtime of runtimes.values()) {
        await runtime.pendingFlow?.dispose().catch(() => {});
        runtime.pendingFlow = null;
      }
    },
  };

  // Readiness is derived from routing, so a routing change alone changes the published state.
  let lastRoutingKey = routingKey(options.settingsStore.getSettings());
  const unsubscribeSettings = options.settingsStore.subscribe((settings) => {
    const next = routingKey(settings);
    if (next === lastRoutingKey) {
      return;
    }
    lastRoutingKey = next;
    void publishState();
  });

  return service;
}

function routingKey(settings: {
  transcription: { providerId: string | null };
  inference: { providerId: string | null };
}) {
  return `${settings.transcription.providerId}/${settings.inference.providerId}`;
}
