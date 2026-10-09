/**
 * A block model over polished markdown.
 *
 * It knows nothing about polishing, sessions, or providers. Its only job is to describe polished
 * text as a sequence of blocks so that incremental polishing can freeze a prefix and hand the model
 * a rewritable tail. Ported from the evaluated reference in the plan's `artifacts/incremental.py`.
 */

export type PolishedBlockKind = 'heading' | 'list' | 'question' | 'answer' | 'paragraph';

const listItemPattern = /^(?:[-*] |\d+\. )/;
const indentedContinuationPattern = /^[ \t]{2,}\S/;
const questionPattern = /^Question( \d+)?:/;
const answerPattern = /^Answer( \d+)?:/;
const blockSeparator = '\n\n';

export const defaultTailFloorChars = 600;
export const defaultTailCapChars = 3_000;
export const defaultContextWindowChars = 1_000;

function trimLeadingWhitespace(text: string) {
  return text.replace(/^\s+/, '');
}

function startsListBlock(block: string) {
  return listItemPattern.test(trimLeadingWhitespace(block));
}

/**
 * Split markdown into blocks separated by blank lines.
 *
 * Contiguous list items form a single block, and an indented continuation paragraph belongs to the
 * list block above it. That is what makes "never split a list" expressible: a list the speaker is
 * still building is one indivisible unit, so it can never be half frozen and half rewritable.
 *
 * Ordered list items merge on the same terms as bulleted ones. The reference merged only `- ` and
 * `* ` while classifying `1. ` as a list, so a loose ordered list — which the engineer preset
 * produces whenever the speaker counts explicitly — could be split across the boundary.
 */
export function splitPolishedBlocks(text: string): string[] {
  const parts = text
    .trim()
    .split(/\n\s*\n/)
    .filter((part) => part.trim().length > 0);

  const blocks: string[] = [];
  for (const part of parts) {
    const previous = blocks.at(-1);
    const continuesList =
      previous !== undefined &&
      startsListBlock(previous) &&
      (startsListBlock(part) || indentedContinuationPattern.test(part));

    if (continuesList) {
      blocks[blocks.length - 1] = `${previous}${blockSeparator}${part}`;
    } else {
      blocks.push(part);
    }
  }

  return blocks;
}

export function classifyPolishedBlock(block: string): PolishedBlockKind {
  const start = trimLeadingWhitespace(block);
  if (start.startsWith('#')) {
    return 'heading';
  }
  if (listItemPattern.test(start)) {
    return 'list';
  }
  if (questionPattern.test(start)) {
    return 'question';
  }
  if (answerPattern.test(start)) {
    return 'answer';
  }
  return 'paragraph';
}

export function joinPolishedBlocks(blocks: string[]): string {
  return blocks.join(blockSeparator);
}

/**
 * Split polished text into the frozen prefix and the rewritable tail.
 *
 * The tail is the trailing open structural unit plus one preceding block, extended to at least
 * `floorChars` and shrunk back towards `capChars`. An open unit is the last question, or a heading
 * whose body so far is short; a heading with a settled body is a safe commit point.
 *
 * The cap yields in two cases, both deliberate: shrinking never takes the tail below the floor, and
 * the tail never begins part-way into a list block. Freezing a list the speaker may still be adding
 * to is the exact failure the rewritable tail exists to prevent.
 */
export function splitRewritableTail(
  text: string,
  options: { floorChars?: number; capChars?: number } = {},
): { frozen: string; tail: string } {
  const floorChars = options.floorChars ?? defaultTailFloorChars;
  const capChars = options.capChars ?? defaultTailCapChars;

  const blocks = splitPolishedBlocks(text);
  if (blocks.length === 0) {
    return { frozen: '', tail: '' };
  }

  const blockCount = blocks.length;
  const sizeFrom = (index: number) => joinPolishedBlocks(blocks.slice(index)).length;

  let start = blockCount - 1;
  for (let index = blockCount - 1; index >= 0; index -= 1) {
    if (sizeFrom(index) > capChars) {
      break;
    }

    const kind = classifyPolishedBlock(blocks[index] as string);
    if (kind === 'question') {
      start = Math.min(start, index);
      break;
    }
    if (kind === 'heading') {
      const bodySoFar = sizeFrom(index) - (blocks[index] as string).length;
      if (bodySoFar <= floorChars) {
        start = Math.min(start, index);
      }
      break;
    }
  }

  // One preceding block, so a structure trigger that landed just before the open unit is revisable.
  if (start > 0) {
    start -= 1;
  }
  while (start > 0 && sizeFrom(start) < floorChars) {
    start -= 1;
  }
  // A heading immediately above the tail belongs with the body it introduces.
  while (start > 0 && classifyPolishedBlock(blocks[start - 1] as string) === 'heading') {
    start -= 1;
  }
  while (
    start < blockCount - 1 &&
    sizeFrom(start) > capChars &&
    classifyPolishedBlock(blocks[start] as string) !== 'list' &&
    sizeFrom(start + 1) >= floorChars
  ) {
    start += 1;
  }

  return {
    frozen: joinPolishedBlocks(blocks.slice(0, start)).trim(),
    tail: joinPolishedBlocks(blocks.slice(start)).trim(),
  };
}

/**
 * The trailing window of the frozen prefix, cut at block boundaries, used as read-only context for
 * continuity: names, tense, numbering, and whether a list or question is already open.
 */
export function selectContextWindow(frozen: string, options: { chars?: number } = {}): string {
  const chars = options.chars ?? defaultContextWindowChars;
  const blocks = splitPolishedBlocks(frozen);

  const window: string[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    window.unshift(blocks[index] as string);
    if (joinPolishedBlocks(window).length >= chars) {
      break;
    }
  }

  return joinPolishedBlocks(window);
}
