import { AppState } from 'react-native';

import { recordDictation } from '../../history';
import { readTranscriptionConfig } from '../../provider';
import { startNativeDictation } from '../engine/native-host';
import { createSessionStore, type DictationPhase } from './session-store';

export type { DictationPhase } from './session-store';

/** The app's one in-app dictation session, recording through the `toph-voice` native module. */
export const useSessionStore = createSessionStore({
  readTranscriptionConfig,
  startDictation: startNativeDictation,
  recordDictation,
});

export function useDictationPhase(): DictationPhase {
  return useSessionStore((state) => state.phase);
}

// Leaving the app while recording ends the dictation the same way tapping stop does, so the
// transcript is still produced. The subscription lives as long as the app.
AppState.addEventListener('change', (state) => {
  if (state === 'background') {
    useSessionStore.getState().stop();
  }
});
