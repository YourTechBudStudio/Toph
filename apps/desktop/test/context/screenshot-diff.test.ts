import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  compareScreenshotFingerprints,
  createScreenshotFingerprintFromBgraBitmap,
  isDuplicateScreenshotDiff,
} from '../../src/main/context/screenshot-diff.ts';

function createBgraBitmap(
  width: number,
  height: number,
  color: { b: number; g: number; r: number },
) {
  const bitmap = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const byteIndex = index * 4;
    bitmap[byteIndex] = color.b;
    bitmap[byteIndex + 1] = color.g;
    bitmap[byteIndex + 2] = color.r;
    bitmap[byteIndex + 3] = 255;
  }
  return bitmap;
}

test('treats visually identical screenshot fingerprints as duplicates', () => {
  const previous = createScreenshotFingerprintFromBgraBitmap(
    createBgraBitmap(4, 2, { b: 24, g: 48, r: 96 }),
    4,
    2,
  );
  const next = createScreenshotFingerprintFromBgraBitmap(
    createBgraBitmap(4, 2, { b: 24, g: 48, r: 96 }),
    4,
    2,
  );

  const diff = compareScreenshotFingerprints(previous, next);

  assert.equal(diff.meanAbsoluteDifference, 0);
  assert.equal(diff.changedPixelRatio, 0);
  assert.equal(isDuplicateScreenshotDiff(diff), true);
});

test('treats materially different screenshot fingerprints as new context', () => {
  const previous = createScreenshotFingerprintFromBgraBitmap(
    createBgraBitmap(4, 2, { b: 24, g: 48, r: 96 }),
    4,
    2,
  );
  const next = createScreenshotFingerprintFromBgraBitmap(
    createBgraBitmap(4, 2, { b: 224, g: 220, r: 210 }),
    4,
    2,
  );

  const diff = compareScreenshotFingerprints(previous, next);

  assert.ok(diff.meanAbsoluteDifference > 0.3);
  assert.equal(diff.changedPixelRatio, 1);
  assert.equal(isDuplicateScreenshotDiff(diff), false);
});
