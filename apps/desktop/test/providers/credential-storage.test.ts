import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  readProviderCredentialStorage,
  updateProviderCredential,
  writeProviderCredentialStorage,
} from '../../src/main/providers/credential-storage.ts';

async function credentialsPath() {
  return join(await mkdtemp(join(tmpdir(), 'toph-credentials-')), 'auth.json');
}

const oauth = { type: 'oauth', access: 'a', refresh: 'r', expires: 1, accountId: 'acct' } as const;
const form = { type: 'form', values: { baseUrl: 'https://example.test/v1', apiKey: 'k' } } as const;

test('round-trips both credential kinds and keeps the file private', async () => {
  const path = await credentialsPath();
  await writeProviderCredentialStorage(path, { 'openai-sub': oauth, openai: form });

  assert.deepEqual(await readProviderCredentialStorage(path), {
    'openai-sub': oauth,
    openai: form,
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('drops unknown ids and entries that do not validate', async () => {
  const path = await credentialsPath();
  await writeFile(
    path,
    JSON.stringify({
      'openai-sub': oauth,
      openai: { type: 'form', values: { apiKey: 7 } },
      'made-up': form,
    }),
  );

  assert.deepEqual(await readProviderCredentialStorage(path), { 'openai-sub': oauth });
});

test('removing one provider leaves the others untouched', async () => {
  const path = await credentialsPath();
  await writeProviderCredentialStorage(path, { 'openai-sub': oauth, openai: form });

  await updateProviderCredential(path, 'openai-sub', null);

  assert.deepEqual(await readProviderCredentialStorage(path), { openai: form });
});

test('replacing one provider leaves the others untouched', async () => {
  const path = await credentialsPath();
  await writeProviderCredentialStorage(path, { 'openai-sub': oauth, openai: form });

  await updateProviderCredential(path, 'openai', {
    type: 'form',
    values: { baseUrl: 'https://other.test/v1', apiKey: 'k2' },
  });

  const storage = await readProviderCredentialStorage(path);
  assert.deepEqual(storage['openai-sub'], oauth);
  assert.deepEqual(storage.openai, {
    type: 'form',
    values: { baseUrl: 'https://other.test/v1', apiKey: 'k2' },
  });
});

test('an unreadable file is replaced with an empty store rather than failing startup', async () => {
  const path = await credentialsPath();
  await writeFile(path, 'not json');

  assert.deepEqual(await readProviderCredentialStorage(path), {});
  assert.equal((await readFile(path, 'utf8')).trim(), '{}');
});
