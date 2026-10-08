import { NativeModule, requireNativeModule } from 'expo';

/**
 * Silero scores for consecutive 512-sample frames, as sample offsets from the start of the audio.
 * Milliseconds are left to JS, so the rounding is desktop's own expression.
 */
export type FramesEvent = {
  startSamples: number[];
  endSamples: number[];
  probabilities: number[];
  /** The last event of a capture. It carries the zero-padded tail frame, if any. */
  final: boolean;
  /** Set only on a final event, when capture failed on the way. */
  error: string | null;
};

export type SourceRange = { startMs: number; endMs: number };

/**
 * Native audio work for dictation: capture, Silero scoring and batch cutting.
 *
 * Contract JS relies on:
 * - After `startCapture` resolves, exactly one `onFrames` event with `final: true` is emitted, by
 *   `stopCapture`, before it resolves, on every path. It is the capture's last event. If
 *   `startCapture` rejects, nothing is running and no event is emitted.
 * - Events of one capture arrive in sample order; offsets count from the capture's first sample.
 * - A mic failure ends capture early and travels on the final event's `error`. `stopCapture` never
 *   rejects; with nothing running it resolves at once and emits nothing.
 * - Audio is written to raw.wav before it is scored, so any range planned from emitted frames can
 *   be cut.
 * - One Silero user at a time: `startCapture` and `scoreWavFile` reject with
 *   "Voice detection is busy." while a capture or a scoring run is in progress.
 *
 * Wait for the final event, not for `stopCapture`: delivery order between an event and a promise
 * result is not guaranteed.
 */
declare class TophVoiceModule extends NativeModule<{
  onFrames: (event: FramesEvent) => void;
}> {
  /** Loads Silero the first time (with one warm-up inference), opens raw.wav and starts the mic. */
  startCapture(rawWavUri: string): Promise<void>;
  /** Stops the mic, scores the tail, fixes the WAV header, emits the final event, then resolves. Never rejects. */
  stopCapture(): Promise<void>;
  /** Writes the given ranges of raw.wav, in order, as one 16 kHz mono PCM16 WAV. */
  cutBatch(rawWavUri: string, ranges: SourceRange[], outUri: string): Promise<void>;
  /** Parity only: scores a whole 16 kHz mono PCM16 WAV exactly as capture would, tail included. */
  scoreWavFile(wavUri: string): Promise<FramesEvent>;
}

export const TophVoice = requireNativeModule<TophVoiceModule>('TophVoice');
