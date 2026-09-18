import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderFieldSpec } from '@toph/desktop-contracts';

import type {
  InferenceClient,
  ProviderDefinition,
  TranscriptionClient,
} from '../../src/main/providers/provider-definition.ts';
import { createProviderRegistry } from '../../src/main/providers/provider-registry.ts';

function modelField(): ProviderFieldSpec {
  return { kind: 'text', key: 'model', label: 'Model', default: 'a-model', required: true };
}

const transcriptionClient = {
  id: 'x',
  transcribeBatch: async () => ({}),
} as unknown as TranscriptionClient;
const inferenceClient = { id: 'x', inferText: async () => ({}) } as unknown as InferenceClient;

function definition(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: 'openai-sub',
    label: 'Subscription',
    description: 'A provider.',
    billingMode: 'subscription',
    roles: ['transcription', 'inference'],
    auth: {
      kind: 'oauth',
      createFlow: async () => ({}) as never,
      refresh: async () => ({}) as never,
    },
    settingsFields: {
      provider: [],
      transcription: [modelField()],
      inference: [modelField()],
    },
    createTranscriptionClient: () => transcriptionClient,
    createInferenceClient: () => inferenceClient,
    ...overrides,
  };
}

test('looks providers up by id and by role', () => {
  const registry = createProviderRegistry([
    definition(),
    definition({
      id: 'openai',
      roles: ['inference'],
      settingsFields: { provider: [], transcription: [], inference: [modelField()] },
      createTranscriptionClient: undefined,
    }),
  ]);

  assert.equal(registry.get('openai-sub')?.id, 'openai-sub');
  assert.equal(registry.get('not-a-provider'), null);
  assert.deepEqual(
    registry.listForRole('transcription').map((entry) => entry.id),
    ['openai-sub'],
  );
  assert.deepEqual(
    registry.listForRole('inference').map((entry) => entry.id),
    ['openai-sub', 'openai'],
  );
});

test('a registry may hold a subset of the known provider ids', () => {
  const registry = createProviderRegistry([definition()]);

  assert.equal(registry.list().length, 1);
  assert.equal(registry.get('openai'), null);
});

test('rejects a served role with no matching client factory', () => {
  assert.throws(
    () => createProviderRegistry([definition({ createInferenceClient: undefined })]),
    /serves the "inference" role but declares no createInferenceClient/,
  );
});

test('rejects a served role without a required model setting', () => {
  assert.throws(
    () =>
      createProviderRegistry([
        definition({
          settingsFields: { provider: [], transcription: [modelField()], inference: [] },
        }),
      ]),
    /does not declare a required "model" text setting/,
  );

  assert.throws(
    () =>
      createProviderRegistry([
        definition({
          settingsFields: {
            provider: [],
            transcription: [modelField()],
            inference: [{ kind: 'text', key: 'model', label: 'Model', default: 'a-model' }],
          },
        }),
      ]),
    /does not declare a required "model" text setting/,
  );
});

test('rejects a connection field that cannot survive the string-only round trip', () => {
  assert.throws(
    () =>
      createProviderRegistry([
        definition({
          auth: {
            kind: 'form',
            fields: [{ kind: 'toggle', key: 'insecure', label: 'Allow insecure', default: false }],
            verify: async () => ({ accountId: null }),
          },
        }),
      ]),
    /connection forms support text fields only/,
  );
});

test('rejects unknown ids, duplicates and duplicate setting keys', () => {
  assert.throws(
    () => createProviderRegistry([definition({ id: 'nope' as never })]),
    /is not a known provider id/,
  );
  assert.throws(
    () => createProviderRegistry([definition(), definition()]),
    /is registered more than once/,
  );
  assert.throws(
    () =>
      createProviderRegistry([
        definition({
          settingsFields: {
            provider: [],
            transcription: [modelField(), modelField()],
            inference: [modelField()],
          },
        }),
      ]),
    /declares the setting "model" more than once/,
  );
});
