/**
 * Ids are persisted as primary keys, so the format is fixed: `<prefix>_<timestamp>_<uuid>`.
 * `crypto.randomUUID` is a web global the host must provide: Electron's main process has it, and
 * the mobile app installs it at its JS entry.
 */
export function createId(prefix: string, timestamp = Date.now()) {
  return `${prefix}_${timestamp}_${globalThis.crypto.randomUUID()}`;
}
