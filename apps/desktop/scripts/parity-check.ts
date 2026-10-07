/**
 * Desktop half of the mobile parity check (architecture D9).
 *
 * Mobile mirrors desktop's PCM framing (Kotlin) and segmentation order (TypeScript) rather than
 * sharing them, so this check guards against drift: it runs desktop's real segmentation pipeline,
 * with real Silero, over the same WAV the phone scored, and compares the phone's `mobile.json`
 * (written by `apps/mobile/src/modules/dictation/engine/parity.ts`).
 *
 * Usage: pnpm --filter @toph/desktop parity:mobile <raw.wav> <mobile.json>
 *
 * Prints the frame counts, the largest probability difference and the threshold flips, and exits
 * non-zero when frame counts, regions or batches differ.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { PlannedTranscriptionBatch, TimelineRegionDraft } from '@toph/dictation-core';

import type { StreamingSpeechActivityAnalyzer } from '../src/main/segmentation/streaming/types.ts';
import { registerTsExtensionResolver } from '../test/helpers/ts-extension-resolver.ts';

interface MobileRecord {
  probabilities: number[];
  regions: TimelineRegionDraft[];
  batches: PlannedTranscriptionBatch[];
}

const [wavArgument, mobileJsonArgument] = process.argv.slice(2);
if (wavArgument === undefined || mobileJsonArgument === undefined) {
  console.error('Usage: pnpm --filter @toph/desktop parity:mobile <raw.wav> <mobile.json>');
  process.exit(2);
}
// pnpm runs the script from apps/desktop; resolve paths against where the command was typed.
const callerDirectory = process.env.INIT_CWD ?? process.cwd();
const wavPath = resolve(callerDirectory, wavArgument);
const mobileJsonPath = resolve(callerDirectory, mobileJsonArgument);

// Desktop sources import their siblings without extensions, so the hook must be in place before
// they load.
registerTsExtensionResolver();
const { createSileroStreamingSpeechActivityAnalyzer } =
  await import('../src/main/segmentation/analyzers/silero-streaming-speech-activity-analyzer.ts');
const { createSegmentationPipelineSession } =
  await import('../src/main/segmentation/streaming/segmentation-pipeline-session.ts');
const { streamPcm16MonoWav } =
  await import('../src/main/segmentation/streaming/wav-stream-source.ts');

/** Records every Silero score, tail frame included, as the phone's `probabilities` do. */
function recordingProbabilities(
  analyzer: StreamingSpeechActivityAnalyzer,
  probabilities: number[],
): StreamingSpeechActivityAnalyzer {
  return {
    name: analyzer.name,
    sampleRate: analyzer.sampleRate,
    frameSizeSamples: analyzer.frameSizeSamples,
    async createSession() {
      const session = await analyzer.createSession();
      return {
        async scoreFrame(frame) {
          const probability = await session.scoreFrame(frame);
          probabilities.push(probability);
          return probability;
        },
        flush: () => session.flush(),
        dispose: () => session.dispose(),
      };
    },
  };
}

async function runDesktop() {
  const probabilities: number[] = [];
  const noop = async () => {};
  const pipeline = await createSegmentationPipelineSession({
    sessionId: 'parity',
    rawAudioPath: wavPath,
    createdLive: true,
    generateBatchAudio: false,
    analyzer: recordingProbabilities(createSileroStreamingSpeechActivityAnalyzer(), probabilities),
    sessionStore: {
      insertTimelineRegions: noop,
      insertPlannedBatches: noop,
      updateBatchDerivedAudioPaths: noop,
    },
  });
  try {
    await streamPcm16MonoWav({
      filePath: wavPath,
      onChunk: (chunk) => pipeline.processPcmChunk(chunk),
    });
    const { regions, batches } = await pipeline.flush();
    return { probabilities, regions, batches };
  } finally {
    await pipeline.dispose();
  }
}

// One projection for both sides. Ids differ by design; region confidence is an average that may
// differ in its last digit.
const projectRegions = (regions: TimelineRegionDraft[]) =>
  regions.map(({ kind, startMs, endMs }) => ({ kind, startMs, endMs }));
const projectBatches = (batches: PlannedTranscriptionBatch[]) =>
  batches.map(({ sequence, sourceDurationMs, derivedAudioDurationMs, sourceRanges }) => ({
    sequence,
    sourceDurationMs,
    derivedAudioDurationMs,
    sourceRanges: sourceRanges.map(
      ({ sourceStartMs, sourceEndMs, derivedStartMs, derivedEndMs, reason }) => ({
        sourceStartMs,
        sourceEndMs,
        derivedStartMs,
        derivedEndMs,
        reason,
      }),
    ),
  }));

/** Index and both sides of the first differing entry, or null when the lists are equal. */
function firstDifference<T>(desktop: T[], mobile: T[]) {
  for (let index = 0; index < Math.max(desktop.length, mobile.length); index += 1) {
    if (JSON.stringify(desktop[index]) !== JSON.stringify(mobile[index])) {
      return { index, desktop: desktop[index] ?? null, mobile: mobile[index] ?? null };
    }
  }
  return null;
}

const mobile = JSON.parse(await readFile(mobileJsonPath, 'utf8')) as MobileRecord;
const desktop = await runDesktop();

const pairedFrames = Math.min(desktop.probabilities.length, mobile.probabilities.length);
let maxDifference = 0;
const flips = { 0.5: 0, 0.35: 0 };
for (let index = 0; index < pairedFrames; index += 1) {
  const desktopProbability = desktop.probabilities[index] ?? 0;
  const mobileProbability = mobile.probabilities[index] ?? 0;
  maxDifference = Math.max(maxDifference, Math.abs(desktopProbability - mobileProbability));
  for (const threshold of [0.5, 0.35] as const) {
    if (desktopProbability >= threshold !== mobileProbability >= threshold) {
      flips[threshold] += 1;
    }
  }
}

const regionDifference = firstDifference(
  projectRegions(desktop.regions),
  projectRegions(mobile.regions),
);
const batchDifference = firstDifference(
  projectBatches(desktop.batches),
  projectBatches(mobile.batches),
);
const framesMatch = desktop.probabilities.length === mobile.probabilities.length;

console.log(
  `Frames: desktop ${desktop.probabilities.length}, mobile ${mobile.probabilities.length}`,
);
console.log(`Max probability difference: ${maxDifference}`);
console.log(`Threshold flips: ${flips[0.5]} at 0.5, ${flips[0.35]} at 0.35`);
console.log(`Regions: desktop ${desktop.regions.length}, mobile ${mobile.regions.length}`);
console.log(`Batches: desktop ${desktop.batches.length}, mobile ${mobile.batches.length}`);

let failed = false;
if (!framesMatch) {
  console.error('MISMATCH: frame counts differ.');
  failed = true;
}
if (regionDifference !== null) {
  console.error('MISMATCH: regions differ at', JSON.stringify(regionDifference));
  failed = true;
}
if (batchDifference !== null) {
  console.error('MISMATCH: batches differ at', JSON.stringify(batchDifference));
  failed = true;
}
console.log(failed ? 'Parity check FAILED.' : 'Parity check passed.');
process.exit(failed ? 1 : 0);
