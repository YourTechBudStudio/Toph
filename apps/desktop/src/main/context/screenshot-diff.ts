export const screenshotFingerprintWidth = 32;
export const screenshotFingerprintHeight = 18;
export const screenshotDuplicateMeanDifferenceThreshold = 0.035;
export const screenshotDuplicateChangedPixelRatioThreshold = 0.08;

export interface ScreenshotFingerprint {
  width: number;
  height: number;
  luminance: Uint8Array;
}

export interface ScreenshotDiffResult {
  meanAbsoluteDifference: number;
  changedPixelRatio: number;
}

export function createScreenshotFingerprintFromBgraBitmap(
  bitmap: Uint8Array,
  width = screenshotFingerprintWidth,
  height = screenshotFingerprintHeight,
): ScreenshotFingerprint {
  const pixelCount = width * height;
  const expectedLength = pixelCount * 4;
  if (bitmap.length < expectedLength) {
    throw new Error(
      `Screenshot fingerprint bitmap is too small: expected ${expectedLength} bytes, got ${bitmap.length}.`,
    );
  }

  const luminance = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const byteIndex = pixelIndex * 4;
    const blue = bitmap[byteIndex] ?? 0;
    const green = bitmap[byteIndex + 1] ?? 0;
    const red = bitmap[byteIndex + 2] ?? 0;
    luminance[pixelIndex] = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  }

  return { width, height, luminance };
}

export function compareScreenshotFingerprints(
  previous: ScreenshotFingerprint,
  next: ScreenshotFingerprint,
): ScreenshotDiffResult {
  if (previous.width !== next.width || previous.height !== next.height) {
    return { meanAbsoluteDifference: 1, changedPixelRatio: 1 };
  }

  let differenceTotal = 0;
  let changedPixels = 0;
  for (let index = 0; index < previous.luminance.length; index += 1) {
    const difference = Math.abs((previous.luminance[index] ?? 0) - (next.luminance[index] ?? 0));
    differenceTotal += difference;
    if (difference > 18) {
      changedPixels += 1;
    }
  }

  const denominator = previous.luminance.length || 1;
  return {
    meanAbsoluteDifference: differenceTotal / denominator / 255,
    changedPixelRatio: changedPixels / denominator,
  };
}

export function isDuplicateScreenshotDiff(diff: ScreenshotDiffResult) {
  return (
    diff.meanAbsoluteDifference < screenshotDuplicateMeanDifferenceThreshold &&
    diff.changedPixelRatio < screenshotDuplicateChangedPixelRatioThreshold
  );
}
