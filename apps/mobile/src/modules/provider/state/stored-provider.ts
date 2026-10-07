import type { PolishApi } from './provider';

/** The saved connection, as stored under `toph.provider.connection`. */
export interface StoredConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** The saved model fields, as stored under `toph.provider.models`. */
export interface StoredModels {
  readonly transcriptionModel: string;
  readonly polishModel: string;
  readonly reasoningEffort: string;
  readonly polishApi: PolishApi;
}

/**
 * Reads a saved connection. `null` means there is nothing usable: the entry is missing, is not
 * JSON, or does not have the expected shape. The caller decides whether that deserves a warning.
 */
export function parseStoredConnection(raw: string | null): StoredConnection | null {
  const value = parseObject(raw);
  if (value === null || typeof value.baseUrl !== 'string' || typeof value.apiKey !== 'string') {
    return null;
  }
  return { baseUrl: value.baseUrl, apiKey: value.apiKey };
}

/** Reads the saved model fields, with the same `null` meaning as `parseStoredConnection`. */
export function parseStoredModels(raw: string | null): StoredModels | null {
  const value = parseObject(raw);
  if (
    value === null ||
    typeof value.transcriptionModel !== 'string' ||
    typeof value.polishModel !== 'string' ||
    typeof value.reasoningEffort !== 'string' ||
    (value.polishApi !== 'chat' && value.polishApi !== 'responses')
  ) {
    return null;
  }
  return {
    transcriptionModel: value.transcriptionModel,
    polishModel: value.polishModel,
    reasoningEffort: value.reasoningEffort,
    polishApi: value.polishApi,
  };
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
