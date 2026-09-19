import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createClientContext,
  jsonResponse,
  stubFetch,
} from '../helpers/provider-client-harness.ts';
import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createOpenAiInferenceClient } =
  await import('../../src/main/providers/openai/inference-client.ts');
const { isTransientInferenceProviderError } =
  await import('../../src/main/providers/provider-definition.ts');

async function infer(options: {
  inference: Record<string, string>;
  respond: () => Response;
  baseUrl?: string;
}) {
  const { context, pricingCalls } = createClientContext({
    formValues: { baseUrl: options.baseUrl ?? 'https://api.openai.com/v1', apiKey: 'sk-test' },
    settings: { inference: options.inference },
  });
  const fetchStub = stubFetch(options.respond);
  try {
    const result = await createOpenAiInferenceClient(context)
      .inferText({ instructions: 'Clean this up.', inputText: 'um hello' })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    const request = fetchStub.only();
    return {
      result,
      request,
      body: JSON.parse(String(request.init.body)) as Record<string, unknown>,
      pricingCalls,
    };
  } finally {
    fetchStub.restore();
  }
}

const chatSettings = { model: 'gpt-5.4-mini', reasoningEffort: '', api: 'chat' };
const responsesSettings = { model: 'gpt-5.4-mini', reasoningEffort: '', api: 'responses' };

const chatSuccess = () =>
  jsonResponse(
    200,
    {
      choices: [{ message: { content: '  Hello.  ' } }],
      usage: {
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens: 25,
      },
    },
    { 'x-request-id': 'req-chat' },
  );

const responsesSuccess = () =>
  jsonResponse(
    200,
    {
      output: [
        {
          type: 'message',
          content: [
            { type: 'reasoning', text: 'ignored' },
            { type: 'output_text', text: 'Hello.' },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 25,
      },
    },
    { 'x-request-id': 'req-responses' },
  );

test('chat mode posts a system and user message and reads text and usage', async () => {
  const { result, request, body, pricingCalls } = await infer({
    inference: chatSettings,
    respond: chatSuccess,
  });

  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(body, {
    model: 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: 'Clean this up.' },
      { role: 'user', content: 'um hello' },
    ],
    stream: false,
  });
  assert.equal('reasoning_effort' in body, false);

  assert.ok(result.ok);
  assert.equal(result.value.text, 'Hello.');
  assert.equal(result.value.provider, 'openai');
  assert.equal(result.value.providerRequestId, 'req-chat');
  assert.equal(result.value.usage.inputTokens, 100);
  assert.equal(result.value.usage.cachedInputTokens, 40);
  assert.equal(result.value.usage.outputTokens, 25);
  assert.deepEqual(pricingCalls[0].usage, {
    kind: 'tokens',
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 25,
  });
  assert.equal(pricingCalls[0].allowStaticFallback, true);
});

test('chat mode sends reasoning_effort only when the setting is non-empty', async () => {
  const { body } = await infer({
    inference: { ...chatSettings, reasoningEffort: 'low' },
    respond: chatSuccess,
  });

  assert.equal(body.reasoning_effort, 'low');
});

test('responses mode posts instructions and input and reads text and usage', async () => {
  const { result, request, body, pricingCalls } = await infer({
    inference: responsesSettings,
    respond: responsesSuccess,
  });

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(body, {
    model: 'gpt-5.4-mini',
    instructions: 'Clean this up.',
    input: 'um hello',
    store: false,
    stream: false,
  });
  assert.equal('reasoning' in body, false);

  assert.ok(result.ok);
  // The raw HTTP payload carries no `output_text`, so this is the walk that runs against OpenAI.
  assert.equal(result.value.text, 'Hello.');
  assert.equal(result.value.providerRequestId, 'req-responses');
  assert.equal(result.value.usage.inputTokens, 100);
  assert.equal(result.value.usage.cachedInputTokens, 40);
  assert.equal(result.value.usage.outputTokens, 25);
  assert.deepEqual(pricingCalls[0].usage, {
    kind: 'tokens',
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 25,
  });
});

test('responses mode sends the reasoning object only when the setting is non-empty', async () => {
  const { body } = await infer({
    inference: { ...responsesSettings, reasoningEffort: 'high' },
    respond: responsesSuccess,
  });

  assert.deepEqual(body.reasoning, { effort: 'high' });
});

test('responses mode prefers a top-level output_text when a compatible server sends one', async () => {
  const { result } = await infer({
    inference: responsesSettings,
    respond: () => jsonResponse(200, { output_text: 'Hello.', output: [] }),
  });

  assert.ok(result.ok);
  assert.equal(result.value.text, 'Hello.');
});

test('defaults to chat mode when no api setting is stored', async () => {
  const { request } = await infer({
    inference: { model: 'gpt-5.4-mini', reasoningEffort: '' },
    respond: chatSuccess,
  });

  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
});

test("withholds this app's static rates from a third-party endpoint", async () => {
  const { pricingCalls } = await infer({
    inference: chatSettings,
    baseUrl: 'https://llama.internal/v1',
    respond: chatSuccess,
  });

  assert.equal(pricingCalls[0].allowStaticFallback, false);
});

for (const [label, settings, respond] of [
  ['chat', chatSettings, () => jsonResponse(200, { choices: [{ message: { content: '  ' } }] })],
  ['responses', responsesSettings, () => jsonResponse(200, { output: [] })],
] as const) {
  test(`${label} mode treats an empty output as transient`, async () => {
    const { result } = await infer({ inference: settings, respond });

    assert.equal(result.ok, false);
    assert.ok(isTransientInferenceProviderError(result.error));
  });
}

test('treats a 500 as transient and a 400 as permanent', async () => {
  const transient = await infer({
    inference: chatSettings,
    respond: () => jsonResponse(500, { error: 'boom' }),
  });
  assert.ok(isTransientInferenceProviderError(transient.result.error));

  const permanent = await infer({
    inference: chatSettings,
    respond: () => jsonResponse(400, { error: 'bad request' }),
  });
  assert.equal(isTransientInferenceProviderError(permanent.result.error), false);
  assert.ok(permanent.result.error instanceof Error);
});

test('reports no cost when the response carries no usage', async () => {
  const { result, pricingCalls } = await infer({
    inference: chatSettings,
    respond: () => jsonResponse(200, { choices: [{ message: { content: 'Hello.' } }] }),
  });

  assert.ok(result.ok);
  assert.equal(pricingCalls.length, 0);
  assert.equal(result.value.usage.inputTokens, null);
  assert.equal(result.value.usage.costSource, 'none');
});

test('still classifies a retryable status when the error body is unparseable JSON', async () => {
  const { result } = await infer({
    inference: chatSettings,
    respond: () =>
      new Response('upstream timeout', {
        status: 504,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(result.ok, false);
  assert.ok(isTransientInferenceProviderError(result.error));
  assert.match(String(result.error), /HTTP 504/);
});

test('retries when the body drops mid-stream on an otherwise successful response', async () => {
  const { result } = await infer({
    inference: chatSettings,
    respond: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  assert.equal(result.ok, false);
  assert.ok(isTransientInferenceProviderError(result.error));
  assert.match(String(result.error), /body could not be read/);
});
