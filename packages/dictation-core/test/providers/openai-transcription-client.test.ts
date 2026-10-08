import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenAiTranscriptionClient,
  type OpenAiTranscriptionClientContext,
} from '../../src/providers/openai/transcription-client.ts';
import { isTransientTranscriptionProviderError } from '../../src/transcription/transcription-client.ts';
import type { CostEstimateInput } from '../../src/usage/pricing.ts';
import { jsonResponse, stubFetch } from '../helpers/fetch-stub.ts';

const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

async function transcribe(options: { respond: () => Response; baseUrl?: string }) {
  const pricingCalls: CostEstimateInput[] = [];
  const context: OpenAiTranscriptionClientContext = {
    credentials: async () => ({
      formValues: { baseUrl: options.baseUrl ?? 'https://api.openai.com/v1', apiKey: 'sk-test' },
    }),
    pricing: {
      estimateCost(input) {
        pricingCalls.push(input);
        return {
          costUsdMicros: 0,
          costSource: 'none',
          pricingCatalogProviderId: null,
          pricingCatalogModelId: null,
        };
      },
    },
    billingMode: 'metered',
  };
  const fetchStub = stubFetch(options.respond);
  try {
    const result = await createOpenAiTranscriptionClient(context)
      .transcribeBatch({
        batchId: 'batch-1',
        audio,
        durationMs: 120_000,
        model: 'gpt-4o-transcribe',
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    return { result, request: fetchStub.only(), pricingCalls };
  } finally {
    fetchStub.restore();
  }
}

test('posts wav audio as multipart with the routed model and returns the transcript', async () => {
  const { result, request, pricingCalls } = await transcribe({
    respond: () => jsonResponse(200, { text: 'hello world' }, { 'x-request-id': 'req-1' }),
  });

  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
  const headers = request.init.headers as Record<string, string>;
  const contentType = headers['Content-Type'];
  assert.match(contentType, /^multipart\/form-data; boundary=toph-/);
  assert.deepEqual(headers, {
    Accept: 'application/json',
    Authorization: 'Bearer sk-test',
    'Content-Type': contentType,
  });

  // Node's own multipart parser is the evidence the hand-built body is well formed.
  const form = await new Response(request.init.body, {
    headers: { 'content-type': contentType },
  }).formData();
  assert.equal(form.get('model'), 'gpt-4o-transcribe');
  assert.equal(form.get('response_format'), 'json');
  const file = form.get('file') as File;
  assert.ok(file instanceof File);
  assert.equal(file.name, 'batch-1.wav');
  assert.equal(file.type, 'audio/wav');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio);

  assert.ok(result.ok);
  assert.equal(result.value.text, 'hello world');
  assert.equal(result.value.provider, 'openai');
  assert.equal(result.value.model, 'gpt-4o-transcribe');
  assert.equal(result.value.providerRequestId, 'req-1');
  assert.deepEqual(result.value.providerResponseJson, { text: 'hello world' });
  assert.equal(result.value.usage.audioDurationMs, 120_000);
  assert.equal(result.value.usage.billableDurationMs, 120_000);

  assert.deepEqual(pricingCalls, [
    {
      providerId: 'openai',
      model: 'gpt-4o-transcribe',
      usage: { kind: 'audio_duration', durationMs: 120_000 },
      allowStaticFallback: true,
    },
  ]);
});

test("withholds this app's static rates from a third-party endpoint", async () => {
  const { pricingCalls } = await transcribe({
    baseUrl: 'https://whisper.internal/v1',
    respond: () => jsonResponse(200, { text: 'hello world' }),
  });

  assert.equal(pricingCalls[0].allowStaticFallback, false);
});

test('treats a 429 as transient so the batch is retried', async () => {
  const { result } = await transcribe({
    respond: () => jsonResponse(429, { error: 'slow down' }),
  });

  assert.equal(result.ok, false);
  assert.ok(isTransientTranscriptionProviderError(result.error));
});

test('treats a 400 as permanent so the batch is not retried', async () => {
  const { result } = await transcribe({
    respond: () => jsonResponse(400, { error: 'bad model' }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
  assert.equal(isTransientTranscriptionProviderError(result.error), false);
});

test('fails permanently when the response carries no transcript text', async () => {
  const { result } = await transcribe({
    respond: () => jsonResponse(200, { segments: [] }),
  });

  assert.equal(result.ok, false);
  assert.equal(isTransientTranscriptionProviderError(result.error), false);
  assert.match(String(result.error), /did not include transcript text/);
});

test('returns an empty transcript as a success, because silence is not a failure', async () => {
  const { result } = await transcribe({
    respond: () => jsonResponse(200, { text: '' }),
  });

  assert.ok(result.ok);
  assert.equal(result.value.text, '');
});

test('still classifies a retryable status when the error body is unparseable JSON', async () => {
  // Gateways in front of a compatible host routinely label a truncated error body as JSON. The
  // status, not the body, has to decide whether the batch is retried.
  const { result } = await transcribe({
    respond: () =>
      new Response('', { status: 502, headers: { 'content-type': 'application/json' } }),
  });

  assert.equal(result.ok, false);
  assert.ok(isTransientTranscriptionProviderError(result.error));
  assert.match(String(result.error), /HTTP 502/);
});

/** A response whose body drops mid-stream, after the headers have already arrived. */
function brokenBodyResponse(status: number) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

test('retries when the body drops mid-stream on an otherwise successful response', async () => {
  const { result } = await transcribe({ respond: () => brokenBodyResponse(200) });

  assert.equal(result.ok, false);
  assert.ok(isTransientTranscriptionProviderError(result.error));
  assert.match(String(result.error), /body could not be read/);
});

test('a dropped body does not make a permanent status retryable', async () => {
  // The status is the authoritative signal: a 400 stays permanent whatever happened to its body.
  const { result } = await transcribe({ respond: () => brokenBodyResponse(400) });

  assert.equal(result.ok, false);
  assert.equal(isTransientTranscriptionProviderError(result.error), false);
  assert.match(String(result.error), /HTTP 400/);
});
