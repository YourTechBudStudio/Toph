import assert from 'node:assert/strict';
import test from 'node:test';

import { jsonResponse, stubFetch } from '../helpers/provider-client-harness.ts';
import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { verifyOpenAiConnection } =
  await import('../../src/main/providers/openai/connection-check.ts');

test('accepts a connection when the endpoint answers at all', async () => {
  const fetchStub = stubFetch(() => jsonResponse(200, { data: [] }));
  try {
    const result = await verifyOpenAiConnection({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });

    assert.equal(fetchStub.only().url, 'https://api.openai.com/v1/models');
    assert.equal(
      (fetchStub.only().init.headers as Record<string, string>).Authorization,
      'Bearer sk-test',
    );
    assert.equal(result.accountId, null);
  } finally {
    fetchStub.restore();
  }
});

test('accepts a status other than 401 or 403, because compatible servers vary', async () => {
  const fetchStub = stubFetch(() => jsonResponse(404, { error: 'not found' }));
  try {
    await verifyOpenAiConnection({ baseUrl: 'https://llama.local/v1', apiKey: 'sk-test' });
  } finally {
    fetchStub.restore();
  }
});

for (const status of [401, 403]) {
  test(`rejects an authentication failure (HTTP ${status})`, async () => {
    const fetchStub = stubFetch(() => jsonResponse(status, { error: 'nope' }));
    try {
      await assert.rejects(
        verifyOpenAiConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'bad' }),
        new RegExp(`Invalid API key \\(HTTP ${status}\\)\\.`),
      );
    } finally {
      fetchStub.restore();
    }
  });
}

test('rejects when the host cannot be reached', async () => {
  const fetchStub = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  try {
    await assert.rejects(
      verifyOpenAiConnection({ baseUrl: 'https://nowhere.invalid/v1', apiKey: 'sk-test' }),
      /Could not reach https:\/\/nowhere\.invalid\/v1: TypeError: fetch failed/,
    );
  } finally {
    fetchStub.restore();
  }
});

test('canonicalises the base URL it was given and returns it for storage', async () => {
  const fetchStub = stubFetch(() => jsonResponse(200, { data: [] }));
  try {
    const result = await verifyOpenAiConnection({
      baseUrl: '  https://api.openai.com/v1//  ',
      apiKey: 'sk-test',
    });

    assert.equal(fetchStub.only().url, 'https://api.openai.com/v1/models');
    assert.deepEqual(result.values, {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
  } finally {
    fetchStub.restore();
  }
});

test('rejects a base URL with no scheme as invalid input, not as a network failure', async () => {
  const fetchStub = stubFetch(() => jsonResponse(200, { data: [] }));
  try {
    await assert.rejects(
      verifyOpenAiConnection({ baseUrl: 'api.openai.com/v1', apiKey: 'sk-test' }),
      /is not a valid URL\. Include the scheme/,
    );
    assert.equal(fetchStub.calls.length, 0, 'nothing should be requested for an unusable URL');
  } finally {
    fetchStub.restore();
  }
});

test('gives up on a host that never answers, and says so distinctly', async () => {
  const fetchStub = stubFetch(() => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  });
  try {
    await assert.rejects(
      verifyOpenAiConnection({ baseUrl: 'https://blackhole.invalid/v1', apiKey: 'sk-test' }),
      /did not respond within 10 seconds\./,
    );
    // The deadline is what makes the connect cancellable at all; without it undici waits ~300s.
    assert.ok(fetchStub.only().init.signal, 'the request must carry a timeout signal');
  } finally {
    fetchStub.restore();
  }
});
