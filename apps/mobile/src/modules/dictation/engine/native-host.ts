import { Directory, File } from 'expo-file-system';

import { TophVoice } from '../../../../modules/toph-voice';
import { appDirectory } from '../../../storage/app-files';
import { sessionRecords } from '../../history';
import { polishSources } from '../../polish';
import { oneDictationAtATime, startDictation, type DictationHost } from './dictation';

/** Deletes a file-system entry if it exists. Never throws: a leftover file only costs space. */
function deleteQuietly(entry: Directory, what: string): void {
  try {
    if (entry.exists) {
      entry.delete();
    }
  } catch (error) {
    console.warn(`[toph:dictation] could not delete ${what}`, error);
  }
}

/**
 * The real device: the `toph-voice` module, history's database writes, the polish module's
 * settings, and session folders under the app's documents at `recordings/<sessionId>/`
 * (`raw.wav`, `batches/batch-NNNN.wav`). `raw.wav` is kept for history until retention prunes the
 * session; `batches/` is deleted after every run, and a discarded run loses its whole folder.
 */
export const nativeDictationHost: DictationHost = {
  voice: TophVoice,
  records: sessionRecords,
  polish: polishSources,

  createSessionFolder(sessionId) {
    const directory = appDirectory('recordings', sessionId);
    directory.create({ intermediates: true });
    const batches = new Directory(directory, 'batches');
    return {
      rawWavUri: new File(directory, 'raw.wav').uri,
      relativeRawAudioPath: `recordings/${sessionId}/raw.wav`,
      // Desktop's naming (batch-audio-writer.ts): the 1-based sequence, padded to four digits.
      batchUri: (sequence) =>
        new File(batches, `batch-${String(sequence + 1).padStart(4, '0')}.wav`).uri,
      readBytes: (uri) => new File(uri).bytes(),
      deleteBatches: () => deleteQuietly(batches, 'session batches'),
      delete: () => deleteQuietly(directory, 'session folder'),
    };
  },
};

/** Starts a dictation on this device, one at a time across Home and the keyboard. Same contract as `startDictation`. */
export const startNativeDictation = oneDictationAtATime((config) =>
  startDictation(config, nativeDictationHost),
);
