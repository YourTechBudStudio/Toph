import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  AppSettings,
  ProviderFieldSpec,
  ProviderId,
  ProviderState,
} from '@toph/desktop-contracts';

import {
  readProviderCredentialStorage,
  writeProviderCredentialStorage,
  type ProviderCredentialStorage,
} from '../../src/main/providers/credential-storage.ts';
import type {
  InferenceClient,
  ProviderDefinition,
  TranscriptionClient,
} from '../../src/main/providers/provider-definition.ts';
import { createProviderRegistry } from '../../src/main/providers/provider-registry.ts';
import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createProviderService } = await import('../../src/main/providers/provider-service.ts');

function modelField(defaultValue: string): ProviderFieldSpec {
  return { kind: 'text', key: 'model', label: 'Model', default: defaultValue, required: true };
}

const oauthTokens = { access: 'access', refresh: 'refresh', expires: Date.now() + 3_600_000 };

type OAuthRefresh = (refreshToken: string) => Promise<typeof oauthTokens & { accountId?: string }>;

/** Serves both roles through OAuth, like the shipped subscription provider. */
function oauthDefinition(refresh: OAuthRefresh = async () => oauthTokens): ProviderDefinition {
  return {
    id: 'openai-sub',
    label: 'Subscription',
    description: 'OAuth provider.',
    billingMode: 'subscription',
    roles: ['transcription', 'inference'],
    auth: {
      kind: 'oauth',
      createFlow: async () => ({
        authorizationUrl: 'https://auth.test/authorize',
        exchangeAuthorizationInput: async () => oauthTokens,
        waitForCallback: async () => oauthTokens,
        dispose: async () => {},
      }),
      refresh,
    },
    settingsFields: {
      provider: [],
      transcription: [modelField('sub-transcribe')],
      inference: [modelField('sub-polish')],
    },
    createTranscriptionClient: () => ({ id: 'openai-sub' }) as unknown as TranscriptionClient,
    createInferenceClient: () => ({ id: 'openai-sub' }) as unknown as InferenceClient,
  };
}

/** Serves inference only, behind a connection form: the shape phase 04 fills in for real. */
function formDefinition(verify: FormAuthVerify): ProviderDefinition {
  return {
    id: 'openai',
    label: 'API key',
    description: 'Form provider.',
    billingMode: 'metered',
    roles: ['inference'],
    auth: {
      kind: 'form',
      fields: [
        { kind: 'text', key: 'baseUrl', label: 'Base URL', default: '', required: true },
        {
          kind: 'text',
          key: 'apiKey',
          label: 'API key',
          default: '',
          required: true,
          secret: true,
        },
      ],
      verify,
    },
    settingsFields: {
      provider: [],
      transcription: [],
      inference: [modelField('api-polish')],
    },
    createInferenceClient: () => ({ id: 'openai' }) as unknown as InferenceClient,
  };
}

type FormAuthVerify = (values: Record<string, string>) => Promise<{
  accountId: string | null;
  values?: Record<string, string>;
}>;

function createSettingsStore(initial?: {
  transcription?: ProviderId | null;
  inference?: ProviderId | null;
}) {
  const listeners = new Set<(settings: AppSettings) => void>();
  let settings = {
    // `null` is a meaningful value here (an unrouted role), so only `undefined` takes the default.
    transcription: {
      providerId: initial?.transcription === undefined ? 'openai-sub' : initial.transcription,
    },
    inference: {
      providerId: initial?.inference === undefined ? 'openai-sub' : initial.inference,
    },
    providers: {
      'openai-sub': {
        provider: {},
        transcription: { model: 'sub-transcribe' },
        inference: { model: 'sub-polish' },
      },
      openai: { provider: {}, transcription: {}, inference: { model: 'api-polish' } },
    },
  } as unknown as AppSettings;

  const write = (role: 'transcription' | 'inference', providerId: ProviderId | null) => {
    settings = { ...settings, [role]: { providerId } } as AppSettings;
    for (const listener of listeners) {
      listener(settings);
    }
    return settings;
  };

  return {
    store: {
      getSettings: () => settings,
      subscribe(listener: (settings: AppSettings) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setTranscriptionProvider: async (providerId: ProviderId | null) =>
        write('transcription', providerId),
      setInferenceProvider: async (providerId: ProviderId | null) => write('inference', providerId),
    },
    route(role: 'transcription' | 'inference', providerId: ProviderId | null) {
      write(role, providerId);
    },
  };
}

async function createService(
  options: {
    verify?: FormAuthVerify;
    settings?: ReturnType<typeof createSettingsStore>;
    refresh?: OAuthRefresh;
    /** Written to the credentials file before the service is constructed. */
    seed?: ProviderCredentialStorage;
  } = {},
) {
  const settings = options.settings ?? createSettingsStore();
  const published: ProviderState[] = [];
  const credentialsPath = join(await mkdtemp(join(tmpdir(), 'toph-providers-')), 'auth.json');
  if (options.seed) {
    await writeProviderCredentialStorage(credentialsPath, options.seed);
  }
  const service = createProviderService({
    registry: createProviderRegistry([
      oauthDefinition(options.refresh),
      formDefinition(options.verify ?? (async () => ({ accountId: null }))),
    ]),
    credentialsPath,
    settingsStore: settings.store,
    pricing: { estimateCost: () => ({}) as never },
    openExternal: async () => {},
    onStateChanged: (state) => published.push(state),
  });
  return { service, published, credentialsPath, settings };
}

function connection(state: ProviderState, id: ProviderId) {
  const found = state.providers.find((provider) => provider.id === id);
  assert.ok(found, `expected a published connection for "${id}"`);
  return found;
}

test('publishes each provider with its declared data', async () => {
  const { service } = await createService();

  const state = await service.getState();

  assert.deepEqual(
    state.providers.map((provider) => provider.id),
    ['openai-sub', 'openai'],
  );
  assert.deepEqual(connection(state, 'openai-sub').auth, { kind: 'oauth' });
  assert.deepEqual(connection(state, 'openai').roles, ['inference']);
  assert.equal(connection(state, 'openai').auth.kind, 'form');
  assert.equal(connection(state, 'openai-sub').status, 'missing');
});

test('readiness needs both routed providers, not just the transcription one', async () => {
  const settings = createSettingsStore({ transcription: 'openai-sub', inference: 'openai' });
  const { service } = await createService({ settings });

  assert.equal((await service.getState()).ready, false);

  await service.connectProvider('openai-sub');
  assert.equal((await service.getState()).ready, false, 'inference provider is still missing');

  await service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: 'k' });
  assert.equal((await service.getState()).ready, true);
});

test('a rejected connection form stores nothing and publishes the reason', async () => {
  const settings = createSettingsStore({ transcription: 'openai-sub', inference: 'openai' });
  const { service, published, credentialsPath } = await createService({
    settings,
    verify: async () => {
      throw new Error('HTTP 401 from the endpoint.');
    },
  });

  await assert.rejects(
    () => service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: 'bad' }),
    /HTTP 401/,
  );

  assert.deepEqual(await readProviderCredentialStorage(credentialsPath), {});
  const last = published.at(-1);
  assert.ok(last);
  assert.equal(connection(last, 'openai').status, 'invalid');
  assert.match(connection(last, 'openai').error ?? '', /HTTP 401/);
});

test('a missing required connection value is rejected before the provider is contacted', async () => {
  let verified = false;
  const { service, credentialsPath } = await createService({
    verify: async () => {
      verified = true;
      return { accountId: null };
    },
  });

  await assert.rejects(
    () => service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: '  ' }),
    /API key is required/,
  );
  assert.equal(verified, false);
  assert.deepEqual(await readProviderCredentialStorage(credentialsPath), {});
});

test('a connected form provider publishes non-secret values only', async () => {
  const { service } = await createService({ verify: async () => ({ accountId: 'acct-1' }) });

  const state = await service.connectProvider('openai', {
    baseUrl: 'https://api.test/v1',
    apiKey: 'secret-key',
  });

  assert.deepEqual(connection(state, 'openai').connectionSummary, {
    baseUrl: 'https://api.test/v1',
  });
  assert.equal(connection(state, 'openai').accountId, 'acct-1');
  assert.equal(connection(state, 'openai').expires, null);
});

test('stores the values verify canonicalised, not the ones submitted', async () => {
  // `verify` may rewrite what it was handed, so the value stored, the value published and the
  // value the clients call are one string rather than three.
  const { service, credentialsPath } = await createService({
    verify: async (values) => ({
      accountId: null,
      values: { ...values, baseUrl: values.baseUrl.replace(/\/+$/, '') },
    }),
  });

  const state = await service.connectProvider('openai', {
    baseUrl: 'https://api.test/v1/',
    apiKey: 'secret-key',
  });

  assert.deepEqual(connection(state, 'openai').connectionSummary, {
    baseUrl: 'https://api.test/v1',
  });
  assert.deepEqual((await readProviderCredentialStorage(credentialsPath)).openai, {
    type: 'form',
    values: { baseUrl: 'https://api.test/v1', apiKey: 'secret-key' },
  });
});

test('resolves transcription clients only for providers that serve the role', async () => {
  const { service } = await createService();

  assert.equal(service.resolveTranscriptionClient('openai-sub')?.id, 'openai-sub');
  assert.equal(service.resolveTranscriptionClient('openai'), null, 'serves inference only');
  assert.equal(service.resolveTranscriptionClient('a-provider-from-an-older-build'), null);
});

test('the inference client follows routing, and routing changes republish state', async () => {
  const settings = createSettingsStore();
  const { service, published } = await createService({ settings });

  assert.equal(service.resolveInferenceClient().id, 'openai-sub');

  const before = published.length;
  settings.route('inference', 'openai');
  // The republish reads the credentials file, so let its microtask chain drain.
  for (let attempt = 0; attempt < 50 && published.length === before; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  assert.ok(published.length > before, 'a routing change must republish provider state');
  assert.equal(service.resolveInferenceClient().id, 'openai');
  assert.deepEqual(service.getRouting(), {
    transcription: { providerId: 'openai-sub', model: 'sub-transcribe' },
    inference: { providerId: 'openai', model: 'api-polish' },
  });
});

test('removing one provider keeps the other connected', async () => {
  const { service } = await createService();

  await service.connectProvider('openai-sub');
  await service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: 'k' });

  const state = await service.removeProvider('openai');

  assert.equal(connection(state, 'openai-sub').status, 'connected');
  assert.equal(connection(state, 'openai').status, 'missing');
});

test('credentials for an unconnected provider name the provider to connect', async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.resolveCredentials('openai'),
    /Connect the API key provider before dictating\./,
  );
});

// The refresh machine deletes stored credentials unattended, on every `getState()` and mid-dictation
// through `resolveCredentials`, so each path below is exercised against a real credentials file.

const connectedForm = {
  type: 'form',
  values: { baseUrl: 'https://api.test/v1', apiKey: 'k' },
} as const;

function oauthCredential(expiresInMs: number) {
  return {
    type: 'oauth',
    access: 'old-access',
    refresh: 'old-refresh',
    expires: Date.now() + expiresInMs,
    accountId: 'acct-original',
  } as const;
}

test('a failed refresh clears only the provider that failed', async () => {
  const { service, published, credentialsPath } = await createService({
    seed: { 'openai-sub': oauthCredential(-1_000), openai: connectedForm },
    refresh: async () => {
      throw new Error('refresh token was revoked');
    },
  });

  const state = await service.getState();

  const storage = await readProviderCredentialStorage(credentialsPath);
  assert.equal(storage['openai-sub'], undefined, 'the failing provider is cleared');
  assert.deepEqual(storage.openai, connectedForm, 'the other provider survives');
  assert.equal(connection(state, 'openai-sub').status, 'invalid');
  assert.match(connection(state, 'openai-sub').error ?? '', /revoked/);
  assert.equal(connection(state, 'openai').status, 'connected');
  assert.equal(published.length, 0, 'getState reports rather than publishes');
});

test('a successful refresh keeps the account id the new tokens omit', async () => {
  const { service, credentialsPath } = await createService({
    seed: { 'openai-sub': oauthCredential(-1_000) },
    refresh: async (refreshToken) => {
      assert.equal(refreshToken, 'old-refresh');
      return { access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 3_600_000 };
    },
  });

  const state = await service.getState();

  const stored = (await readProviderCredentialStorage(credentialsPath))['openai-sub'];
  assert.equal(stored?.type, 'oauth');
  assert.equal(stored.access, 'new-access');
  assert.equal(stored.accountId, 'acct-original');
  assert.equal(connection(state, 'openai-sub').status, 'connected');
  assert.equal(connection(state, 'openai-sub').accountId, 'acct-original');
});

test('the expiry skew refreshes a credential that is about to expire but not a fresh one', async () => {
  let refreshes = 0;
  const countingRefresh = async () => {
    refreshes += 1;
    return { access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 3_600_000 };
  };

  const soon = await createService({
    seed: { 'openai-sub': oauthCredential(30_000) },
    refresh: countingRefresh,
  });
  await soon.service.getState();
  assert.equal(refreshes, 1, 'inside the 60s skew');

  refreshes = 0;
  const later = await createService({
    seed: { 'openai-sub': oauthCredential(600_000) },
    refresh: countingRefresh,
  });
  await later.service.getState();
  assert.equal(refreshes, 0, 'outside the 60s skew');
});

test('resolveCredentials refreshes an expired credential before handing it to a client', async () => {
  const { service } = await createService({
    seed: { 'openai-sub': oauthCredential(-1_000) },
    refresh: async () => ({
      access: 'new-access',
      refresh: 'new-refresh',
      expires: Date.now() + 3_600_000,
    }),
  });

  const credentials = await service.resolveCredentials('openai-sub');

  assert.equal(credentials.accessToken, 'new-access');
  assert.equal(credentials.accountId, 'acct-original');
  assert.deepEqual(credentials.formValues, {});
});

test('a refresh that fails mid-dictation clears the credential and publishes the reason', async () => {
  const { service, published, credentialsPath } = await createService({
    seed: { 'openai-sub': oauthCredential(-1_000), openai: connectedForm },
    refresh: async () => {
      throw new Error('refresh token was revoked');
    },
  });

  await assert.rejects(
    () => service.resolveCredentials('openai-sub'),
    /Provider credentials expired\. Reconnect the provider to continue\./,
  );

  const storage = await readProviderCredentialStorage(credentialsPath);
  assert.equal(storage['openai-sub'], undefined);
  assert.deepEqual(storage.openai, connectedForm, 'one provider expiring never touches another');
  const last = published.at(-1);
  assert.ok(last, 'resolveCredentials publishes so the UI reflects the lost connection');
  assert.equal(connection(last, 'openai-sub').status, 'invalid');
  assert.match(connection(last, 'openai-sub').error ?? '', /revoked/);
});

test('a form credential is never put through the OAuth refresh path', async () => {
  let refreshes = 0;
  const { service } = await createService({
    seed: { openai: connectedForm },
    refresh: async () => {
      refreshes += 1;
      return oauthTokens;
    },
  });

  const credentials = await service.resolveCredentials('openai');

  assert.equal(refreshes, 0);
  assert.equal(credentials.accessToken, '');
  assert.deepEqual(credentials.formValues, connectedForm.values);
});

test('connecting claims the unrouted roles it serves, and only those', async () => {
  const settings = createSettingsStore({ transcription: null, inference: null });
  const { service } = await createService({ settings });

  await service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: 'k' });

  // The form provider in these fixtures serves inference only, so transcription stays unrouted.
  assert.deepEqual(service.getRouting(), {
    transcription: { providerId: null, model: '' },
    inference: { providerId: 'openai', model: 'api-polish' },
  });
});

test('connecting never overrides a role that is already routed', async () => {
  const settings = createSettingsStore({ transcription: 'openai-sub', inference: null });
  const { service } = await createService({ settings });

  await service.connectProvider('openai', { baseUrl: 'https://api.test/v1', apiKey: 'k' });

  const routing = service.getRouting();
  assert.equal(routing.transcription.providerId, 'openai-sub');
  assert.equal(routing.inference.providerId, 'openai');
});

test('removing a provider unroutes the roles that pointed at it', async () => {
  const settings = createSettingsStore({ transcription: 'openai-sub', inference: 'openai' });
  const { service } = await createService({
    settings,
    seed: { 'openai-sub': oauthCredential(3_600_000), openai: connectedForm },
  });

  await service.removeProvider('openai');

  const routing = service.getRouting();
  assert.equal(routing.transcription.providerId, 'openai-sub');
  assert.equal(routing.inference.providerId, null);
});

test('an unrouted role is never ready', async () => {
  const settings = createSettingsStore({ transcription: null, inference: 'openai-sub' });
  const { service } = await createService({
    settings,
    seed: { 'openai-sub': oauthCredential(3_600_000) },
  });

  assert.equal((await service.getState()).ready, false);
});

test('a token refresh never claims a role, even while one is unrouted', async () => {
  const settings = createSettingsStore({ transcription: null, inference: null });
  const { service, published } = await createService({
    settings,
    seed: { 'openai-sub': oauthCredential(-1_000) },
    refresh: async () => ({
      access: 'new-access',
      refresh: 'new-refresh',
      expires: Date.now() + 3_600_000,
    }),
  });

  // Refreshing happens inside an ordinary state build, which must not write settings.
  const state = await service.getState();

  assert.equal(connection(state, 'openai-sub').status, 'connected');
  assert.deepEqual(service.getRouting(), {
    transcription: { providerId: null, model: '' },
    inference: { providerId: null, model: '' },
  });
  assert.equal(published.length, 0, 'getState reports rather than publishes');
});

test('an OAuth login claims the unrouted roles it serves', async () => {
  const settings = createSettingsStore({ transcription: null, inference: null });
  const { service } = await createService({ settings });

  await service.connectProvider('openai-sub');

  const routing = service.getRouting();
  assert.equal(routing.transcription.providerId, 'openai-sub');
  assert.equal(routing.inference.providerId, 'openai-sub');
});
