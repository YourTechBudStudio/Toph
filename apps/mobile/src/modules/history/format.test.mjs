import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countWords, formatClock, formatRelative, wordsPerMinute } from './format.ts';

const now = Date.UTC(2026, 9, 6, 12);

describe('formatRelative', () => {
  it('reads like a person would say it', () => {
    assert.equal(formatRelative(now - 20_000, now), 'just now');
    assert.equal(formatRelative(now - 4 * 60_000, now), '4m ago');
    assert.equal(formatRelative(now - 3 * 3_600_000, now), '3h ago');
    assert.equal(formatRelative(now - 30 * 3_600_000, now), 'yesterday');
    assert.equal(formatRelative(now - 5 * 86_400_000, now), '5d ago');
  });

  it('treats a clock that runs ahead as just now', () => {
    assert.equal(formatRelative(now + 5_000, now), 'just now');
  });
});

describe('formatClock', () => {
  it('pads seconds and never shows hours', () => {
    assert.equal(formatClock(7_400), '0:07');
    assert.equal(formatClock(102_000), '1:42');
    assert.equal(formatClock(725_000), '12:05');
    assert.equal(formatClock(-1), '0:00');
  });
});

describe('words', () => {
  it('counts words across any whitespace', () => {
    assert.equal(countWords('  ship it\n\non   Friday '), 4);
    assert.equal(countWords('   '), 0);
  });

  it('has no pace for a blip', () => {
    assert.equal(wordsPerMinute('hi there', 1_000), null);
    assert.equal(wordsPerMinute('one two three four five six', 3_000), 120);
  });
});
