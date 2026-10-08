import { AppRegistry } from 'react-native';

import {
  KEYBOARD_DICTATION_TASK,
  TophKeyboard,
  type KeyboardDictationTask,
  type KeyboardResult,
} from '../../../modules/toph-keyboard';
import {
  describeError,
  splitErrorDetail,
  startNativeDictation,
  type DictationOutcome,
  type DictationRun,
} from '../dictation';
import { loadProvider, readTranscriptionConfig } from '../provider';

/**
 * Registers the task the voice keyboard starts at each mic tap. Call it at bundle load: the
 * keyboard can start JS without opening the app. One task runs one dictation and delivers its
 * result exactly once; while it runs, React Native keeps JS timers going without an Activity.
 */
export function registerKeyboardDictation(): void {
  AppRegistry.registerHeadlessTask(
    KEYBOARD_DICTATION_TASK,
    () => async (task: KeyboardDictationTask) => {
      const { requestId } = task;
      let result: KeyboardResult;
      try {
        result = await dictate(requestId);
      } catch (error) {
        result = { kind: 'failed', message: describeError(error) }; // defensive: nothing below should throw
      }
      console.log('[toph:keyboard]', requestId, 'delivering', result.kind);
      try {
        // Awaited: the task, which keeps JS alive without an Activity, ends only once native has the result.
        await TophKeyboard.deliver(requestId, result);
      } catch (error) {
        console.warn('[toph:keyboard] deliver failed', requestId, error); // contract says it never rejects
      }
    },
  );
}

async function dictate(requestId: string): Promise<KeyboardResult> {
  await loadProvider(); // without an Activity the app's _layout may never have run
  const config = readTranscriptionConfig();
  if (config === null) {
    return { kind: 'no_provider' };
  }
  if (await TophKeyboard.hasStopped(requestId)) {
    return { kind: 'no_speech' }; // ended before the mic opened: never record after the keyboard closed
  }
  let run: DictationRun;
  try {
    run = await startNativeDictation(config);
  } catch (error) {
    return { kind: 'failed', message: `Couldn't start recording: ${describeError(error)}` };
  }
  await TophKeyboard.captureStarted(requestId); // the keyboard switches from "Starting…" to "Listening…"
  await TophKeyboard.waitForStop(requestId);
  return readable(await run.stop()); // never rejects; settles after mic, uploads and files are released
}

/** The keyboard has two caption lines and a toast, so a failure keeps only its readable summary. */
function readable(outcome: DictationOutcome): KeyboardResult {
  return outcome.kind === 'failed'
    ? { kind: 'failed', message: splitErrorDetail(outcome.message).summary }
    : outcome;
}
