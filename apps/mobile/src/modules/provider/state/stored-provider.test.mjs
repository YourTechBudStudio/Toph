import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStoredConnection, parseStoredModels } from './stored-provider.ts';

const models = {
  transcriptionModel: 'gpt-4o-transcribe',
  polishModel: 'gpt-5.4-mini',
  reasoningEffort: '',
  polishApi: 'responses',
};

test('reads a saved connection', () => {
  assert.deepEqual(
    parseStoredConnection(JSON.stringify({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1' })),
    { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1' },
  );
});

test('reads saved model fields', () => {
  assert.deepEqual(parseStoredModels(JSON.stringify(models)), models);
});

test('treats a missing entry as nothing saved', () => {
  assert.equal(parseStoredConnection(null), null);
  assert.equal(parseStoredModels(null), null);
});

test('treats an entry that is not JSON as nothing saved', () => {
  assert.equal(parseStoredConnection('{"baseUrl":'), null);
  assert.equal(parseStoredModels('not json'), null);
});

test('rejects an entry that is JSON but not an object', () => {
  for (const raw of ['null', '"text"', '42', '[]']) {
    assert.equal(parseStoredConnection(raw), null, raw);
    assert.equal(parseStoredModels(raw), null, raw);
  }
});

test('rejects a connection with a missing or wrongly typed field', () => {
  assert.equal(parseStoredConnection(JSON.stringify({ baseUrl: 'https://x/v1' })), null);
  assert.equal(parseStoredConnection(JSON.stringify({ baseUrl: 1, apiKey: 'sk-1' })), null);
});

test('rejects models with a missing or wrongly typed field', () => {
  for (const field of ['transcriptionModel', 'polishModel', 'reasoningEffort']) {
    assert.equal(parseStoredModels(JSON.stringify({ ...models, [field]: undefined })), null, field);
    assert.equal(parseStoredModels(JSON.stringify({ ...models, [field]: 7 })), null, field);
  }
});

test('rejects models whose polish API is not one of the two known ones', () => {
  assert.equal(parseStoredModels(JSON.stringify({ ...models, polishApi: 'completions' })), null);
  assert.equal(parseStoredModels(JSON.stringify({ ...models, polishApi: undefined })), null);
});
