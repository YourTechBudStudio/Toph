import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitErrorDetail } from './error-detail.ts';

describe('splitErrorDetail', () => {
  it('pulls a trailing JSON body out of the summary and indents it', () => {
    const detail = splitErrorDetail(
      'OpenAI transcription failed: HTTP 401 {"error":{"message":"Bad key","code":"invalid_api_key"}}',
    );
    assert.equal(detail.summary, 'OpenAI transcription failed: HTTP 401');
    assert.equal(
      detail.json,
      '{\n  "error": {\n    "message": "Bad key",\n    "code": "invalid_api_key"\n  }\n}',
    );
  });

  it('keeps a message without JSON as it is', () => {
    assert.deepEqual(splitErrorDetail('Connect a provider first.'), {
      summary: 'Connect a provider first.',
      json: null,
    });
  });

  it('keeps a body that does not parse, such as one truncated by the core', () => {
    const message = 'OpenAI transcription failed: HTTP 500 {"error":{"message":"Ser';
    assert.deepEqual(splitErrorDetail(message), { summary: message, json: null });
  });
});
