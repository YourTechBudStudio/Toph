import * as SecureStore from 'expo-secure-store';

let writes: Promise<unknown> = Promise.resolve();

/**
 * Runs `write` after every earlier write, so storage sees them in the order they were made.
 * Resolves whether it saved and never rejects, so a failed write neither breaks the queue nor
 * leaves an unhandled rejection behind a fire-and-forget caller. One queue serves every module.
 */
export function persistSecurely(write: () => Promise<void>, logTag: string): Promise<boolean> {
  const saved = writes.then(write).then(
    () => true,
    (error: unknown) => {
      console.warn(`${logTag} save failed`, error);
      return false;
    },
  );
  writes = saved;
  return saved;
}

/**
 * Enqueues one write of `read()` as JSON under `key`. `read` is called when the write runs, not
 * when it is enqueued, so the value saved is the latest one. Never rejects.
 */
export function writeSecureJson(
  key: string,
  read: () => unknown,
  logTag: string,
): Promise<boolean> {
  return persistSecurely(() => SecureStore.setItemAsync(key, JSON.stringify(read())), logTag);
}

/** One saved JSON entry, or `null` when it is missing, unreadable or malformed. Never rejects. */
export async function readSecureJson<T>(
  key: string,
  parse: (raw: string | null) => T | null,
  logTag: string,
): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn(`${logTag} could not read ${key}`, error);
    return null;
  }
  const value = parse(raw);
  if (raw !== null && value === null) {
    // The contents are never logged: an entry may hold an API key.
    console.warn(`${logTag} ignoring malformed ${key}`);
  }
  return value;
}
