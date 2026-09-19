import { normalizeBaseUrl } from './http';

/**
 * How long to wait for the endpoint to answer. The base URL is typed by hand, so pointing at a host
 * that blackholes packets is an ordinary typo rather than an edge case; without a deadline the
 * connect sits in its connecting state until undici's ~300s header timeout, with no way to cancel.
 */
const connectionTimeoutMs = 10_000;

/**
 * Proves an API key works against a base URL before anything is stored, and canonicalises the base
 * URL while it is at it.
 *
 * Only an authentication failure, an unusable URL or an unreachable host rejects. Any other status
 * is accepted, because "OpenAI-compatible" servers vary widely in what they implement and a 404 on
 * `/models` says nothing about whether transcription works.
 */
export async function verifyOpenAiConnection(values: Record<string, string>): Promise<{
  accountId: string | null;
  values: Record<string, string>;
}> {
  const baseUrl = normalizeBaseUrl(values.baseUrl ?? '');
  const apiKey = values.apiKey ?? '';

  let modelsUrl: URL;
  try {
    modelsUrl = new URL(`${baseUrl}/models`);
  } catch {
    // Distinguished from a network failure so the message points at the field, not at the network.
    throw new Error(
      `"${baseUrl}" is not a valid URL. Include the scheme, for example https://api.openai.com/v1.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(connectionTimeoutMs),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'TimeoutError') {
      throw new Error(`${baseUrl} did not respond within ${connectionTimeoutMs / 1000} seconds.`, {
        cause: error,
      });
    }
    throw new Error(`Could not reach ${baseUrl}: ${String(error)}`, { cause: error });
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Invalid API key (HTTP ${response.status}).`);
  }

  return {
    accountId: null,
    values: { ...values, baseUrl, apiKey },
  };
}
