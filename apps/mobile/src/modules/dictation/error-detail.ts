export interface ErrorDetail {
  /** The readable part, such as "OpenAI transcription failed: HTTP 401". */
  readonly summary: string;
  /** A provider's JSON body, pretty-printed, or null when the message carries none. */
  readonly json: string | null;
}

/**
 * Splits an error message that ends in a JSON body into its summary and the body, indented for
 * reading. Anything else, including a body the core truncated mid-way, stays one plain message.
 */
export function splitErrorDetail(message: string): ErrorDetail {
  const start = message.search(/[[{]/);
  if (start === -1) {
    return { summary: message, json: null };
  }
  let body: unknown;
  try {
    body = JSON.parse(message.slice(start));
  } catch {
    return { summary: message, json: null };
  }
  const summary = message.slice(0, start).trim();
  return { summary: summary === '' ? message : summary, json: JSON.stringify(body, null, 2) };
}
