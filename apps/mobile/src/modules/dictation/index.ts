export { DictationPanel } from './components/DictationPanel';
export { describeError, type DictationRun } from './engine/dictation'; // oneDictationAtATime stays private
export { splitErrorDetail } from './error-detail';
export { startNativeDictation } from './engine/native-host';
export { runParityCheck } from './engine/parity';
export type { DictationOutcome } from './engine/transcription';
export { useDictationPhase, type DictationPhase } from './state/session';
