import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  classifyPolishedBlock,
  joinPolishedBlocks,
  selectContextWindow,
  splitPolishedBlocks,
  splitRewritableTail,
} from '../../src/main/polish/polished-text-blocks.ts';

// Synthetic polished markdown only. The evaluation corpus is real dictation and stays out of the
// repository; these fixtures reproduce its shapes, not its content.
function paragraph(label: string, chars: number) {
  const sentence = `Paragraph ${label} restates the scheduling constraint we agreed on earlier. `;
  let text = '';
  while (text.length < chars) {
    text += sentence;
  }
  return `${text.slice(0, chars - 1).trim()}.`;
}

function listBlock(label: string, items: number, itemChars: number) {
  return Array.from(
    { length: items },
    (_, index) => `- Item ${label}${index + 1}: ${paragraph(`${label}${index + 1}`, itemChars)}`,
  ).join('\n');
}

/** Frozen and tail are always whole blocks of the text, in order, with nothing lost or duplicated. */
function assertBlockBoundary(text: string, result: { frozen: string; tail: string }) {
  const blocks = splitPolishedBlocks(text);
  const frozenBlocks = splitPolishedBlocks(result.frozen);
  const tailBlocks = splitPolishedBlocks(result.tail);

  assert.equal(frozenBlocks.length + tailBlocks.length, blocks.length);
  assert.deepEqual([...frozenBlocks, ...tailBlocks], blocks);
  assert.equal(
    [result.frozen, result.tail].filter((part) => part.length > 0).join('\n\n'),
    joinPolishedBlocks(blocks),
  );
}

test('splits blocks on blank lines and keeps a list as one block', () => {
  const text = [paragraph('a', 80), listBlock('b', 3, 40), paragraph('c', 80)].join('\n\n');
  const blocks = splitPolishedBlocks(text);

  assert.equal(blocks.length, 3);
  assert.equal(classifyPolishedBlock(blocks[1] as string), 'list');
});

test('merges list items separated by blank lines into a single block', () => {
  const text = ['- First item.', '- Second item.', '- Third item.'].join('\n\n');
  const blocks = splitPolishedBlocks(text);

  assert.equal(blocks.length, 1);
  assert.equal(classifyPolishedBlock(blocks[0] as string), 'list');
});

test('merges loosely spaced ordered list items into a single block', () => {
  // The reference merged only `- ` and `* ` while classifying `1. ` as a list, so a loose ordered
  // list could be split across the frozen boundary. The engineer preset emits ordered lists whenever
  // the speaker counts explicitly.
  const text = ['1. First item.', '2. Second item.', '3. Third item.'].join('\n\n');
  const blocks = splitPolishedBlocks(text);

  assert.equal(blocks.length, 1);
  assert.equal(classifyPolishedBlock(blocks[0] as string), 'list');
});

test('attaches an indented continuation paragraph to the list above it', () => {
  const text = ['- First item.', '- Second item.', '  A continuation of the second item.'].join(
    '\n\n',
  );
  const blocks = splitPolishedBlocks(text);

  assert.equal(blocks.length, 1);
  assert.match(blocks[0] as string, /A continuation of the second item\./);
});

test('classifies headings, lists, questions, answers, and paragraphs', () => {
  assert.equal(classifyPolishedBlock('## Migration plan'), 'heading');
  assert.equal(classifyPolishedBlock('### Rollback'), 'heading');
  assert.equal(classifyPolishedBlock('- An item.'), 'list');
  assert.equal(classifyPolishedBlock('* An item.'), 'list');
  assert.equal(classifyPolishedBlock('1. An item.'), 'list');
  assert.equal(classifyPolishedBlock('Question: Should we cache it?'), 'question');
  assert.equal(classifyPolishedBlock('Question 2: Should we cache it?'), 'question');
  assert.equal(classifyPolishedBlock('Answer: Yes.'), 'answer');
  assert.equal(classifyPolishedBlock('Answer 2: Yes.'), 'answer');
  assert.equal(classifyPolishedBlock('Questionable framing, honestly.'), 'paragraph');
  assert.equal(classifyPolishedBlock('Just prose.'), 'paragraph');
});

test('tail is a suffix of the text at a block boundary', () => {
  const text = [
    paragraph('a', 500),
    paragraph('b', 500),
    paragraph('c', 500),
    paragraph('d', 500),
  ].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.ok(text.endsWith(result.tail));
});

test('never splits a list across the boundary', () => {
  const text = [
    paragraph('a', 700),
    paragraph('b', 700),
    listBlock('c', 6, 120),
    paragraph('d', 200),
  ].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);

  const listItems = (text.match(/^- Item c/gm) ?? []).length;
  const tailItems = (result.tail.match(/^- Item c/gm) ?? []).length;
  assert.ok(tailItems === 0 || tailItems === listItems);
});

test('keeps a trailing question that has no answer yet inside the tail', () => {
  const text = [
    paragraph('a', 700),
    paragraph('b', 700),
    paragraph('c', 700),
    'Question 3: Does the settings page need its own route?',
  ].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.match(result.tail, /Question 3:/);
});

test('keeps a heading whose body so far is short inside the tail', () => {
  const text = [
    paragraph('a', 900),
    paragraph('b', 900),
    '## Rollback plan',
    'If anything fails, we restore from the snapshot. That takes about ten minutes.',
  ].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.match(result.tail, /## Rollback plan/);
});

test('treats a heading with a settled body as a commit point', () => {
  const text = [
    paragraph('a', 900),
    '## Rollback plan',
    paragraph('b', 500),
    paragraph('c', 500),
    paragraph('d', 500),
  ].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.match(result.frozen, /## Rollback plan/);
  assert.doesNotMatch(result.tail, /## Rollback plan/);
});

test('extends the tail to at least the floor', () => {
  const text = Array.from({ length: 8 }, (_, index) => paragraph(`p${index}`, 200)).join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.ok(result.tail.length >= 600, `tail was ${result.tail.length} characters`);
});

test('makes the whole text the tail when it is shorter than the floor', () => {
  const text = [paragraph('a', 150), paragraph('b', 150)].join('\n\n');

  const result = splitRewritableTail(text);
  assert.equal(result.frozen, '');
  assert.equal(result.tail, text);
});

test('keeps the tail under the cap when it can', () => {
  const text = Array.from({ length: 12 }, (_, index) => paragraph(`p${index}`, 500)).join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.ok(result.tail.length <= 3_000, `tail was ${result.tail.length} characters`);
  assert.ok(result.frozen.length > 0);
});

test('lets the tail exceed the cap rather than begin part-way into a list', () => {
  // Corrected invariant: the cap yields when the tail would otherwise start inside a list block.
  // Freezing a list the speaker may still be adding to is the failure the tail exists to prevent.
  const text = [paragraph('a', 600), listBlock('b', 10, 340)].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.ok(result.tail.length > 3_000);
  assert.equal(classifyPolishedBlock(splitPolishedBlocks(result.tail)[0] as string), 'list');
  assert.equal(result.frozen, paragraph('a', 600));
});

test('lets the tail exceed the cap rather than fall below the floor', () => {
  // The other cap exception: shrinking is refused when the next candidate tail is under the floor.
  const text = [paragraph('a', 2_800), paragraph('b', 300)].join('\n\n');

  const result = splitRewritableTail(text);
  assertBlockBoundary(text, result);
  assert.ok(result.tail.length > 3_000);
  assert.equal(result.frozen, '');
});

test('returns empty frozen and tail for empty text', () => {
  assert.deepEqual(splitRewritableTail(''), { frozen: '', tail: '' });
  assert.deepEqual(splitRewritableTail('   \n\n  '), { frozen: '', tail: '' });
});

test('selects the trailing context window at block boundaries', () => {
  const frozen = Array.from({ length: 10 }, (_, index) => paragraph(`p${index}`, 300)).join('\n\n');

  const window = selectContextWindow(frozen);
  assert.ok(frozen.endsWith(window));
  assert.ok(window.length >= 1_000, `window was ${window.length} characters`);
  // Block boundaries, so it overshoots by at most one block rather than cutting mid-block.
  assert.ok(window.length < 1_000 + 302);
});

test('returns the whole frozen prefix when it is shorter than the context window', () => {
  const frozen = paragraph('a', 200);
  assert.equal(selectContextWindow(frozen), frozen);
  assert.equal(selectContextWindow(''), '');
});
