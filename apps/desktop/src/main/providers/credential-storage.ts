import { chmod, readFile, writeFile } from 'node:fs/promises';

import { PROVIDER_IDS, type ProviderId } from '@toph/desktop-contracts';

export type OAuthCredential = {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

export type FormCredential = {
  type: 'form';
  values: Record<string, string>;
  /** Whatever the connection check could identify the account as; purely informational. */
  accountId?: string;
};

export type ProviderCredential = OAuthCredential | FormCredential;

export type ProviderCredentialStorage = Partial<Record<ProviderId, ProviderCredential>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isOAuthCredential(value: unknown): value is OAuthCredential {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === 'oauth' &&
    typeof value.access === 'string' &&
    typeof value.refresh === 'string' &&
    typeof value.expires === 'number' &&
    (value.accountId === undefined || typeof value.accountId === 'string')
  );
}

export function isFormCredential(value: unknown): value is FormCredential {
  if (!isRecord(value) || value.type !== 'form' || !isRecord(value.values)) {
    return false;
  }
  if (value.accountId !== undefined && typeof value.accountId !== 'string') {
    return false;
  }

  return Object.values(value.values).every((entry) => typeof entry === 'string');
}

/**
 * Reads whatever validates and silently drops the rest. This file is written by the app alone, so a
 * malformed entry means an interrupted write or a hand edit; refusing to start over one provider's
 * broken entry would be worse than asking for that provider to be reconnected.
 */
export async function readProviderCredentialStorage(
  credentialsPath: string,
): Promise<ProviderCredentialStorage> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    await writeProviderCredentialStorage(credentialsPath, {});
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await writeProviderCredentialStorage(credentialsPath, {});
    return {};
  }
  if (!isRecord(parsed)) {
    return {};
  }

  const storage: ProviderCredentialStorage = {};
  for (const id of PROVIDER_IDS) {
    const credential = parsed[id];
    if (isOAuthCredential(credential) || isFormCredential(credential)) {
      storage[id] = credential;
    }
  }

  return storage;
}

export async function writeProviderCredentialStorage(
  credentialsPath: string,
  storage: ProviderCredentialStorage,
) {
  await writeFile(credentialsPath, `${JSON.stringify(storage, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

/**
 * Replaces exactly one provider's entry, so connecting or removing one provider never disturbs
 * another's credentials.
 */
export async function updateProviderCredential(
  credentialsPath: string,
  id: ProviderId,
  credential: ProviderCredential | null,
): Promise<ProviderCredentialStorage> {
  const storage = await readProviderCredentialStorage(credentialsPath);
  if (credential) {
    storage[id] = credential;
  } else {
    delete storage[id];
  }
  await writeProviderCredentialStorage(credentialsPath, storage);
  return storage;
}
