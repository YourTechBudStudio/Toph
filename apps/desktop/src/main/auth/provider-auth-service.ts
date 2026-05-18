import {
  PROVIDER_BILLING_MODES,
  PROVIDER_IDS,
  type ProviderConnection,
  type ProviderConnectionStatus,
  type ProviderId,
  type ProviderState,
} from '@toph/desktop-contracts';

import {
  readProviderAuthStorage,
  writeProviderAuthStorage,
  type OAuthProviderCredential,
  type ProviderAuthStorage,
} from './auth-storage';
import {
  createAntigravityOAuthFlow,
  refreshAntigravityOAuthToken,
  type AntigravityOAuthTokens,
  type PendingAntigravityOAuthFlow,
} from './providers/antigravity-oauth-flow';
import {
  createOpenAiSubOAuthFlow,
  refreshOpenAiSubOAuthToken,
  type OpenAiSubOAuthTokens,
  type PendingOpenAiSubOAuthFlow,
} from './providers/openai-sub-oauth-flow';

const expirySkewMs = 60_000;

const providerConfigs: Record<
  ProviderId,
  {
    label: string;
    description: string;
  }
> = {
  'openai-sub': {
    label: 'OpenAI (ChatGPT Plus/Pro subscription)',
    description: 'Use your ChatGPT subscription to transcribe recordings and polish output.',
  },
  antigravity: {
    label: 'Google Antigravity OAuth',
    description: 'Use unofficial Antigravity OAuth for Gemini transcription and polish inference.',
  },
};

export interface ProviderCredentials {
  accessToken: string;
  accountId: string | null;
  email: string | null;
  projectId: string | null;
}

export interface ProviderAuthService {
  getState: () => Promise<ProviderState>;
  resolveCredentials: (providerId: ProviderId) => Promise<ProviderCredentials>;
  refreshCredentials: (providerId: ProviderId) => Promise<ProviderCredentials>;
  connectProvider: (providerId: ProviderId) => Promise<ProviderState>;
  submitProviderAuthorization: (providerId: ProviderId, input: string) => Promise<ProviderState>;
  removeProvider: (providerId: ProviderId) => Promise<ProviderState>;
  refreshProviders: () => Promise<ProviderState>;
  dispose: () => Promise<void>;
}

class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

type PendingOAuthFlow = PendingOpenAiSubOAuthFlow | PendingAntigravityOAuthFlow;

function toCredential(
  providerId: ProviderId,
  tokens: OpenAiSubOAuthTokens | AntigravityOAuthTokens,
) {
  return {
    type: 'oauth',
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    accountId: tokens.accountId,
    email: 'email' in tokens ? tokens.email : undefined,
    projectId: 'projectId' in tokens ? tokens.projectId : undefined,
  } satisfies OAuthProviderCredential;
}

function getConnectedAccountLabel(
  providerId: ProviderId,
  credential: OAuthProviderCredential | null,
) {
  if (!credential) {
    return null;
  }
  return providerId === 'antigravity'
    ? (credential.email ?? credential.accountId ?? credential.projectId ?? null)
    : (credential.accountId ?? null);
}

function createProviderState(options: {
  storage: ProviderAuthStorage;
  pendingProviderId: ProviderId | null;
  errors: Partial<Record<ProviderId, string | null>>;
  requiredProviderIds: ProviderId[];
}): ProviderState {
  const providers: ProviderConnection[] = PROVIDER_IDS.map((id) => {
    const credential = options.storage[id] ?? null;
    const connecting = options.pendingProviderId === id;
    const error = options.errors[id] ?? null;
    const status: ProviderConnectionStatus = credential
      ? 'connected'
      : connecting
        ? 'connecting'
        : error
          ? 'invalid'
          : 'missing';
    return {
      id,
      label: providerConfigs[id].label,
      description: providerConfigs[id].description,
      billingMode: PROVIDER_BILLING_MODES[id],
      status,
      accountId: getConnectedAccountLabel(id, credential),
      expires: credential?.expires ?? null,
      error,
    };
  });

  const requiredProviderIds: ProviderId[] =
    options.requiredProviderIds.length > 0 ? options.requiredProviderIds : ['openai-sub'];
  const ready = requiredProviderIds.every(
    (id) => providers.find((provider) => provider.id === id)?.status === 'connected',
  );
  const selectedProviderId: ProviderId =
    requiredProviderIds.find(
      (id) => providers.find((provider) => provider.id === id)?.status !== 'connected',
    ) ??
    requiredProviderIds[0] ??
    providers.find((provider) => provider.status === 'connected')?.id ??
    'openai-sub';

  return {
    ready,
    selectedProviderId,
    providers,
  };
}

function assertProviderId(id: ProviderId) {
  if (!PROVIDER_IDS.includes(id)) {
    throw new ProviderAuthError('Unknown provider.');
  }
}

function uniqueProviderIds(providerIds: ProviderId[]) {
  return [...new Set(providerIds)].filter((id) => PROVIDER_IDS.includes(id));
}

function toProviderCredentials(credential: OAuthProviderCredential): ProviderCredentials {
  return {
    accessToken: credential.access,
    accountId: credential.accountId ?? null,
    email: credential.email ?? null,
    projectId: credential.projectId ?? null,
  };
}

export function createProviderAuthService(options: {
  authPath: string;
  openExternal: (url: string) => Promise<void>;
  getRequiredProviderIds?: () => ProviderId[];
  onStateChanged?: (state: ProviderState) => void;
}): ProviderAuthService {
  let pendingFlow: PendingOAuthFlow | null = null;
  let pendingProviderId: ProviderId | null = null;
  let pendingFlowSettled = true;
  const lastErrors: Partial<Record<ProviderId, string | null>> = {};

  const getRequiredProviderIds = () =>
    uniqueProviderIds(options.getRequiredProviderIds?.() ?? ['openai-sub']);

  const readStorage = () => readProviderAuthStorage(options.authPath);

  const writeStorage = async (storage: ProviderAuthStorage) => {
    await writeProviderAuthStorage(options.authPath, storage);
  };

  const refreshCredential = async (id: ProviderId, credential: OAuthProviderCredential) => {
    if (id === 'antigravity') {
      const refreshed = toCredential(id, await refreshAntigravityOAuthToken(credential.refresh));
      return {
        ...refreshed,
        accountId: refreshed.accountId ?? credential.accountId,
        email: refreshed.email ?? credential.email,
        projectId: refreshed.projectId ?? credential.projectId,
      };
    }

    const refreshed = toCredential(id, await refreshOpenAiSubOAuthToken(credential.refresh));
    return {
      ...refreshed,
      accountId: refreshed.accountId ?? credential.accountId,
    };
  };

  const refreshStoredCredentialIfExpired = async (id: ProviderId) => {
    const storage = await readStorage();
    const credential = storage[id];
    if (!credential || credential.expires > Date.now() + expirySkewMs) {
      return;
    }

    try {
      storage[id] = await refreshCredential(id, credential);
      await writeStorage(storage);
      lastErrors[id] = null;
    } catch (error) {
      lastErrors[id] =
        error instanceof Error ? error.message : 'Provider credentials could not be refreshed.';
      delete storage[id];
      await writeStorage(storage);
    }
  };

  const refreshStoredCredential = async (id: ProviderId) => {
    const storage = await readStorage();
    const credential = storage[id];
    if (!credential) {
      throw new ProviderAuthError(`Connect ${providerConfigs[id].label} before dictating.`);
    }

    try {
      const refreshed = await refreshCredential(id, credential);
      storage[id] = refreshed;
      await writeStorage(storage);
      lastErrors[id] = null;
      await publishState();
      return toProviderCredentials(refreshed);
    } catch (error) {
      lastErrors[id] =
        error instanceof Error ? error.message : 'Provider credentials could not be refreshed.';
      delete storage[id];
      await writeStorage(storage);
      await publishState();
      throw new ProviderAuthError(
        'Provider credentials could not be refreshed. Reconnect the provider to continue.',
      );
    }
  };

  const refreshRequiredCredentialsIfExpired = async () => {
    for (const id of getRequiredProviderIds()) {
      await refreshStoredCredentialIfExpired(id);
    }
  };

  const stateFromDisk = async () =>
    createProviderState({
      storage: await readStorage(),
      pendingProviderId,
      errors: lastErrors,
      requiredProviderIds: getRequiredProviderIds(),
    });

  const publishState = async () => {
    options.onStateChanged?.(await stateFromDisk());
  };

  const storeCredential = async (id: ProviderId, credential: OAuthProviderCredential) => {
    const storage = await readStorage();
    storage[id] = credential;
    await writeStorage(storage);
    lastErrors[id] = null;
  };

  const completeLoginWithTokens = async (
    id: ProviderId,
    tokens: OpenAiSubOAuthTokens | AntigravityOAuthTokens,
  ) => {
    await storeCredential(id, toCredential(id, tokens));
  };

  const runPendingLogin = async (id: ProviderId, flow: PendingOAuthFlow) => {
    try {
      const tokens = await flow.waitForCallback();
      await completeLoginWithTokens(id, tokens);
    } catch (error) {
      const storage = await readStorage();
      if (storage[id]) {
        return;
      }
      lastErrors[id] = error instanceof Error ? error.message : 'Provider login failed.';
      throw error;
    } finally {
      if (pendingFlow === flow) {
        pendingFlow = null;
        pendingProviderId = null;
        pendingFlowSettled = true;
      }
      await flow.dispose().catch(() => {});
      await publishState();
    }
  };

  return {
    async getState() {
      await refreshRequiredCredentialsIfExpired();
      return stateFromDisk();
    },

    async resolveCredentials(id) {
      assertProviderId(id);
      const storage = await readStorage();
      let credential = storage[id];
      if (!credential) {
        throw new ProviderAuthError(`Connect ${providerConfigs[id].label} before dictating.`);
      }

      if (credential.expires <= Date.now() + expirySkewMs) {
        try {
          credential = await refreshCredential(id, credential);
          await storeCredential(id, credential);
        } catch (error) {
          lastErrors[id] =
            error instanceof Error ? error.message : 'Provider credentials could not be refreshed.';
          delete storage[id];
          await writeStorage(storage);
          await publishState();
          throw new ProviderAuthError(
            'Provider credentials expired. Reconnect the provider to continue.',
          );
        }
      }

      return toProviderCredentials(credential);
    },

    async refreshCredentials(id) {
      assertProviderId(id);
      return refreshStoredCredential(id);
    },

    async connectProvider(id) {
      assertProviderId(id);
      if (pendingFlow && !pendingFlowSettled) {
        return stateFromDisk();
      }

      lastErrors[id] = null;
      pendingFlowSettled = false;
      pendingProviderId = id;
      try {
        pendingFlow =
          id === 'antigravity'
            ? await createAntigravityOAuthFlow()
            : await createOpenAiSubOAuthFlow();
      } catch (error) {
        lastErrors[id] = error instanceof Error ? error.message : 'Provider login could not start.';
        pendingFlow = null;
        pendingProviderId = null;
        pendingFlowSettled = true;
        await publishState();
        throw error;
      }
      const flow = pendingFlow;
      await publishState();
      try {
        await options.openExternal(flow.authorizationUrl);
      } catch (error) {
        lastErrors[id] =
          error instanceof Error ? error.message : 'Provider login could not open the browser.';
        pendingFlow = null;
        pendingProviderId = null;
        pendingFlowSettled = true;
        await flow.dispose().catch(() => {});
        await publishState();
        throw error;
      }
      void runPendingLogin(id, flow).catch((error) => {
        console.error(`${providerConfigs[id].label} login failed.`, error);
      });
      return stateFromDisk();
    },

    async submitProviderAuthorization(id, input) {
      assertProviderId(id);
      if (!pendingFlow || pendingProviderId !== id) {
        throw new ProviderAuthError('No provider login is waiting for an authorization code.');
      }

      try {
        const flow = pendingFlow;
        const tokens = await flow.exchangeAuthorizationInput(input);
        await completeLoginWithTokens(id, tokens);
        pendingFlow = null;
        pendingProviderId = null;
        pendingFlowSettled = true;
        await flow.dispose().catch(() => {});
        await publishState();
        return stateFromDisk();
      } catch (error) {
        lastErrors[id] = error instanceof Error ? error.message : 'Provider login failed.';
        await publishState();
        throw error;
      }
    },

    async removeProvider(id) {
      assertProviderId(id);
      if (pendingFlow && pendingProviderId === id) {
        await pendingFlow.dispose().catch(() => {});
        pendingFlow = null;
        pendingProviderId = null;
        pendingFlowSettled = true;
      }
      lastErrors[id] = null;
      const storage = await readStorage();
      delete storage[id];
      await writeStorage(storage);
      await publishState();
      return stateFromDisk();
    },

    async refreshProviders() {
      for (const id of PROVIDER_IDS) {
        lastErrors[id] = null;
        await refreshStoredCredentialIfExpired(id);
      }
      await publishState();
      return stateFromDisk();
    },

    async dispose() {
      await pendingFlow?.dispose().catch(() => {});
      pendingFlow = null;
      pendingProviderId = null;
    },
  };
}
