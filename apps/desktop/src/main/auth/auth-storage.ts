import { chmod, readFile, writeFile } from 'node:fs/promises';

import { PROVIDER_IDS, type ProviderId } from '@toph/desktop-contracts';

export type OAuthProviderCredential = {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  email?: string;
  projectId?: string;
};

export type ProviderAuthStorage = Partial<Record<ProviderId, OAuthProviderCredential>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isOAuthProviderCredential(value: unknown): value is OAuthProviderCredential {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === 'oauth' &&
    typeof value.access === 'string' &&
    typeof value.refresh === 'string' &&
    typeof value.expires === 'number' &&
    (value.accountId === undefined || typeof value.accountId === 'string') &&
    (value.email === undefined || typeof value.email === 'string') &&
    (value.projectId === undefined || typeof value.projectId === 'string')
  );
}

export async function readProviderAuthStorage(authPath: string): Promise<ProviderAuthStorage> {
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    await writeProviderAuthStorage(authPath, {});
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await writeProviderAuthStorage(authPath, {});
    return {};
  }
  if (!isRecord(parsed)) {
    return {};
  }

  const storage: ProviderAuthStorage = {};
  for (const providerId of PROVIDER_IDS) {
    if (isOAuthProviderCredential(parsed[providerId])) {
      storage[providerId] = parsed[providerId];
    }
  }

  return storage;
}

export async function writeProviderAuthStorage(authPath: string, storage: ProviderAuthStorage) {
  await writeFile(authPath, `${JSON.stringify(storage, null, 2)}\n`, { mode: 0o600 });
  await chmod(authPath, 0o600);
}
