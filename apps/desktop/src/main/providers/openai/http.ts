/**
 * HTTP details shared by this provider's connection check and its two clients. Scoped to
 * `providers/openai/` on purpose: `openai-sub` classifies a 403 carrying an HTML body as transient
 * because it scrapes a consumer endpoint behind a bot check, which is not a rule an API-key
 * endpoint should inherit. The two providers have no common change pressure here.
 */

const officialApiHost = 'api.openai.com';

/**
 * Canonical form of a user-supplied base URL: trimmed, with trailing slashes removed, so
 * `https://api.openai.com/v1/` and `https://api.openai.com/v1` produce the same request URLs.
 */
export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Whether the configured endpoint is OpenAI's own API. Static per-minute and per-token rates are
 * OpenAI's published prices and mean nothing for an arbitrary OpenAI-compatible host, so the
 * clients pass this to pricing rather than letting a self-hosted endpoint report OpenAI's costs.
 */
export function isOfficialOpenAiEndpoint(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === officialApiHost;
  } catch {
    return false;
  }
}

export function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function readRequestId(response: Response) {
  return response.headers.get('x-request-id') ?? response.headers.get('request-id');
}

/**
 * Reads a response body without ever throwing, because the callers read it before classifying the
 * status and outside any catch. A gateway in front of an OpenAI-compatible host routinely labels a
 * truncated or empty error body as JSON, and a parse failure there would escape as a plain
 * `SyntaxError`: the caller would classify a retryable 502 as permanent and report it without the
 * status. Returning the raw text instead keeps `isRetryableStatus` in charge and keeps whatever the
 * host did send in the error message.
 */
export async function readResponseBody(response: Response) {
  let text: string;
  try {
    text = await response.text();
  } catch {
    // The connection can drop mid-body; the status is already in hand and decides the outcome.
    return null;
  }

  if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Credential values every call in this provider needs, in the form they are sent. */
export interface OpenAiEndpoint {
  baseUrl: string;
  apiKey: string;
}

export function endpointFromCredentials(formValues: Record<string, string>): OpenAiEndpoint {
  return {
    baseUrl: normalizeBaseUrl(formValues.baseUrl ?? ''),
    apiKey: formValues.apiKey ?? '',
  };
}
