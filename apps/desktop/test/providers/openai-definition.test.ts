import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderFieldSpec } from '@toph/desktop-contracts';

import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

// Unlike `openai-sub`, this definition reaches no bundler-only module, so the real declarations can
// be asserted here rather than restated inline.
const { openAiProviderDefinition } = await import('../../src/main/providers/openai/definition.ts');
const { createProviderRegistry } = await import('../../src/main/providers/provider-registry.ts');

function field(specs: ProviderFieldSpec[], key: string) {
  const found = specs.find((spec) => spec.key === key);
  assert.ok(found, `expected a "${key}" field`);
  return found;
}

test('declares an identity the registry and both roles accept', () => {
  assert.equal(openAiProviderDefinition.id, 'openai');
  assert.equal(openAiProviderDefinition.label, 'OpenAI (API key)');
  assert.equal(openAiProviderDefinition.billingMode, 'metered');
  assert.deepEqual([...openAiProviderDefinition.roles], ['transcription', 'inference']);
  assert.ok(openAiProviderDefinition.createTranscriptionClient);
  assert.ok(openAiProviderDefinition.createInferenceClient);

  // The registry asserts the conventions every consumer relies on; constructing it is the test.
  const registry = createProviderRegistry([openAiProviderDefinition]);
  assert.equal(registry.get('openai'), openAiProviderDefinition);
  assert.deepEqual(registry.listForRole('inference'), [openAiProviderDefinition]);
});

test('declares base URL and API key as required connection fields, with the key secret', () => {
  assert.equal(openAiProviderDefinition.auth.kind, 'form');
  assert.ok(openAiProviderDefinition.auth.kind === 'form');

  const baseUrl = field(openAiProviderDefinition.auth.fields, 'baseUrl');
  assert.equal(baseUrl.kind, 'text');
  assert.ok(baseUrl.kind === 'text');
  assert.equal(baseUrl.default, 'https://api.openai.com/v1');
  assert.equal(baseUrl.required, true);
  assert.notEqual(baseUrl.secret, true);

  const apiKey = field(openAiProviderDefinition.auth.fields, 'apiKey');
  assert.ok(apiKey.kind === 'text');
  assert.equal(apiKey.required, true);
  assert.equal(apiKey.secret, true);
});

test('declares the default models and the inference options the clients read', () => {
  const { settingsFields } = openAiProviderDefinition;
  assert.deepEqual(settingsFields.provider, []);

  const transcriptionModel = field(settingsFields.transcription, 'model');
  assert.ok(transcriptionModel.kind === 'text');
  assert.equal(transcriptionModel.default, 'gpt-4o-transcribe');

  const inferenceModel = field(settingsFields.inference, 'model');
  assert.ok(inferenceModel.kind === 'text');
  assert.equal(inferenceModel.default, 'gpt-5.4-mini');

  // Empty means "omit the parameter", which the inference client depends on.
  const reasoningEffort = field(settingsFields.inference, 'reasoningEffort');
  assert.ok(reasoningEffort.kind === 'text');
  assert.equal(reasoningEffort.default, '');
  assert.notEqual(reasoningEffort.required, true);

  const api = field(settingsFields.inference, 'api');
  assert.ok(api.kind === 'select');
  assert.equal(api.default, 'chat');
  assert.deepEqual(api.options, [
    { value: 'chat', label: 'Chat Completions' },
    { value: 'responses', label: 'Responses' },
  ]);
});
