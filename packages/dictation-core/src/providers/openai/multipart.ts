export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; data: Uint8Array };

/**
 * Encodes multipart/form-data as one byte array, because React Native cannot build a Blob from
 * bytes, so `FormData` with a file part fails on mobile. Names and filenames are fixed by the
 * callers in this package, so they are written as given, without quoting or escaping.
 */
export function encodeMultipartFormData(parts: readonly MultipartPart[]): {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
} {
  const boundary = `toph-${globalThis.crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if ('data' in part) {
      head += `; filename="${part.filename}"\r\nContent-Type: ${part.contentType}`;
    }
    chunks.push(encoder.encode(`${head}\r\n\r\n`));
    chunks.push('data' in part ? part.data : encoder.encode(part.value));
    chunks.push(encoder.encode('\r\n'));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const body = new Uint8Array(new ArrayBuffer(chunks.reduce((sum, c) => sum + c.byteLength, 0)));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
