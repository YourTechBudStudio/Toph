/**
 * How a saved session and its outputs become what history shows: the status, the raw and polished
 * text, and the preset, for finished, polish-off, polish-failed, no-speech and unfinished runs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dictationFallbackText, toDictation } from './dictation-view.ts';

const session = (overrides = {}) => ({
  id: 'session_1',
  createdAt: 1_000,
  startedAt: 1_000,
  endedAt: 5_000,
  durationMs: 4_000,
  rawAudioPath: 'recordings/session_1/raw.wav',
  transcriptionProviderId: 'openai',
  transcriptionModel: 'gpt-4o-transcribe',
  status: 'completed',
  selectedOutputId: null,
  errorMessage: null,
  ...overrides,
});

const output = (overrides) => ({
  sessionId: 'session_1',
  sourceOutputId: null,
  provider: null,
  model: null,
  rulePresetId: null,
  rulePresetHash: null,
  createdAt: 6_000,
  ...overrides,
});

const raw = output({ id: 'out_raw', kind: 'raw_concat', text: 'ship it' });
const polished = output({
  id: 'out_polished',
  kind: 'polished',
  text: 'Ship it.',
  sourceOutputId: 'out_raw',
  provider: 'openai',
  rulePresetId: 'preset-engineer',
  rulePresetHash: 'hash',
});

describe('toDictation', () => {
  it('a polished run is done with raw and polished text and its preset', () => {
    assert.deepEqual(toDictation(session({ selectedOutputId: 'out_polished' }), [raw, polished]), {
      id: 'session_1',
      createdAt: 1_000,
      durationMs: 4_000,
      status: 'done',
      errorMessage: null,
      raw: 'ship it',
      polished: 'Ship it.',
      rulePresetId: 'preset-engineer',
    });
  });

  it('a run with polish off is done with no polished text', () => {
    const dictation = toDictation(session({ selectedOutputId: 'out_raw' }), [raw]);
    assert.equal(dictation.status, 'done');
    assert.equal(dictation.raw, 'ship it');
    assert.equal(dictation.polished, null);
    assert.equal(dictation.rulePresetId, null);
  });

  it('a polish failure is failed with the raw text and the error', () => {
    const message = 'Polish failed unexpectedly. Raw text saved in Toph history. HTTP 404';
    const dictation = toDictation(session({ status: 'failed', errorMessage: message }), [raw]);
    assert.equal(dictation.status, 'failed');
    assert.equal(dictation.raw, 'ship it');
    assert.equal(dictation.polished, null);
    assert.equal(dictation.errorMessage, message);
  });

  it('no speech has no text', () => {
    const dictation = toDictation(session({ status: 'no_speech' }), []);
    assert.equal(dictation.status, 'no_speech');
    assert.equal(dictation.raw, null);
    assert.equal(dictation.polished, null);
    assert.equal(dictationFallbackText(dictation), 'No speech came through.');
  });

  it('a run that never finished (recording failed, or killed while recorded) is failed', () => {
    const dictation = toDictation(
      session({ status: 'recording_failed', endedAt: null, durationMs: null }),
      [],
    );
    assert.equal(dictation.status, 'failed');
    assert.equal(dictation.durationMs, null);
    assert.equal(dictationFallbackText(dictation), "This one didn't finish.");
    assert.equal(
      toDictation(session({ status: 'recorded', durationMs: null }), []).status,
      'failed',
    );
  });
});
