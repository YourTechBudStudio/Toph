import { recordDictation, type Dictation } from '../../history';
import type { DictationPhase } from './session';

/**
 * TEMPORARY design preview for in-app dictation (Toph #7): the ways a real dictation can end, with
 * the copy the program design proposes. Delete with the preview screen once the panel is real.
 */
export interface OutcomeMock {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** What the orb shows. A failure or "no speech" leaves it at rest, ready to go again. */
  readonly phase: Extract<DictationPhase, 'transcribing' | 'done'>;
  readonly headline: string;
  readonly caption: string;
  readonly failed: boolean;
  /** The row this outcome files at the top of Recent; there is no transcript card any more. */
  readonly row: Dictation | null;
}

const transcript: Dictation = {
  id: 'mock-latest',
  createdAt: Date.now(),
  durationMs: 14_200,
  source: 'app',
  raw: 'Can we move the stand-up to ten thirty? My build is still running and I refuse to watch it alone.',
  polished: null,
  presetTitle: null,
};

const failure = (id: string, title: string, detail: string, message: string): OutcomeMock => ({
  id,
  title,
  detail,
  phase: 'done',
  headline: "That didn't work.",
  caption: message,
  failed: true,
  row: null,
});

export const outcomeMocks: readonly OutcomeMock[] = [
  {
    id: 'transcript',
    title: 'Transcript',
    detail: 'No card: the result lands at the top of Recent; copy from its details',
    phase: 'done',
    headline: 'Shipped.',
    caption: 'Tap the orb to go again.',
    failed: false,
    row: transcript,
  },
  {
    id: 'no-speech',
    title: 'No speech',
    detail: 'Stopped without saying anything',
    phase: 'done',
    headline: "Didn't catch that.",
    caption: 'No speech came through. Tap the orb to try again.',
    failed: false,
    row: null,
  },
  {
    id: 'transcribing',
    title: 'Transcribing',
    detail: 'Caption that holds whether or not batches uploaded live',
    phase: 'transcribing',
    headline: 'Transcribing…',
    caption: "Sending what's left of your recording.",
    failed: false,
    row: null,
  },
  failure(
    'wrong-key',
    'Failed: wrong API key',
    "OpenAI's 401, as the core client words it today",
    'OpenAI transcription failed: HTTP 401 {"error":{"message":"Incorrect API key provided: sk-proj-****wxyz. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}',
  ),
  failure(
    'offline',
    'Failed: no network',
    'After three attempts',
    'OpenAI transcription request failed: TypeError: Network request failed',
  ),
  failure(
    'mic-busy',
    'Failed: microphone busy',
    'Another app holds the mic at start',
    "Couldn't start recording: The microphone could not be started.",
  ),
  failure(
    'model-load',
    'Failed: voice detection',
    'Silero did not load; there is no fallback',
    "Couldn't start recording: Error code - ORT_INVALID_PROTOBUF - message: Load model from silero_vad_v5.onnx failed:Protobuf parsing failed.",
  ),
  failure(
    'mic-read',
    'Failed: mic stopped mid-recording',
    'Shown once you tap stop',
    'Recording failed: Microphone read failed (code -3).',
  ),
  failure(
    'no-provider',
    'Failed: no provider',
    'Should not happen behind onboarding',
    'Connect a provider first.',
  ),
];

/**
 * Files a mock outcome's row in the in-memory history, once, the way a finished real dictation
 * will. Mocked for now: it mixes with history's mock entries until story #9.
 */
const filed = new Set<string>();
export function fileOutcomeRow(mock: OutcomeMock): void {
  if (mock.row === null || filed.has(mock.row.id)) {
    return;
  }
  filed.add(mock.row.id);
  recordDictation({ ...mock.row, createdAt: Date.now() });
}
