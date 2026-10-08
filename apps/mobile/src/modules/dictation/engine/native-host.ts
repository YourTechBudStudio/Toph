import { Directory, File, Paths } from 'expo-file-system';

import { TophVoice } from '../../../../modules/toph-voice';
import type { DictationHost } from './dictation';

/**
 * The real device: the `toph-voice` module, and session folders under
 * `Paths.cache/dictation/<sessionId>/` (`raw.wav`, `batches/batch-NNNN.wav`). Nothing keeps session
 * audio after a run ends.
 */
export const nativeDictationHost: DictationHost = {
  voice: TophVoice,

  createSessionFolder(sessionId) {
    const directory = new Directory(Paths.cache, 'dictation', sessionId);
    directory.create({ intermediates: true });
    const batches = new Directory(directory, 'batches');
    return {
      rawWavUri: new File(directory, 'raw.wav').uri,
      // Desktop's naming (batch-audio-writer.ts): the 1-based sequence, padded to four digits.
      batchUri: (sequence) =>
        new File(batches, `batch-${String(sequence + 1).padStart(4, '0')}.wav`).uri,
      readBytes: (uri) => new File(uri).bytes(),
      delete() {
        try {
          if (directory.exists) {
            directory.delete();
          }
        } catch (error) {
          console.warn('[toph:dictation] could not delete session folder', error);
        }
      },
    };
  },
};
