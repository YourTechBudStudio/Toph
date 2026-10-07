import { File, Paths } from 'expo-file-system';

import { TophVoice } from '../../../../modules/toph-voice';
import { createSegmentationRun } from './segmentation';

/**
 * Dev only: the mobile half of the parity check (architecture D9).
 *
 * Scores `<documents>/parity/raw.wav` with native Silero, segments it exactly as live dictation
 * would, and writes the raw records to `<documents>/parity/mobile.json`. Desktop's
 * `apps/desktop/scripts/parity-check.ts` runs desktop's own pipeline over the same WAV and does all
 * the comparing.
 */
export async function runParityCheck(): Promise<{
  frames: number;
  regions: number;
  batches: number;
}> {
  const event = await TophVoice.scoreWavFile(new File(Paths.document, 'parity', 'raw.wav').uri);
  // One final event holding every frame segments the same as many live events.
  const run = createSegmentationRun('parity');
  const batches = run.finish(event);
  new File(Paths.document, 'parity', 'mobile.json').write(
    JSON.stringify({ probabilities: event.probabilities, regions: run.regions, batches }),
  );
  return {
    frames: event.probabilities.length,
    regions: run.regions.length,
    batches: batches.length,
  };
}
