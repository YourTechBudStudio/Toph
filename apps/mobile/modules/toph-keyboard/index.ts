import { NativeModule, requireNativeModule } from 'expo';

/** The headless task the keyboard starts at each mic tap. Must match TASK in KeyboardDictations.kt. */
export const KEYBOARD_DICTATION_TASK = 'TophKeyboardDictation';
export type KeyboardDictationTask = { requestId: string };

/** What the task hands back. `DictationOutcome` is assignable to it. */
export type KeyboardResult =
  | { kind: 'transcript'; text: string }
  | { kind: 'no_speech' }
  | { kind: 'failed'; message: string }
  | { kind: 'no_provider' };

/**
 * The Android voice keyboard.
 *
 * Contract:
 * - The keyboard starts one task per request, with a fresh request id, once the JS runtime can run it.
 * - The task calls `deliver` exactly once per request, on every path.
 * - The task must not start capture for a request that `hasStopped` reports as ended. Once capture
 *   has started, it calls `captureStarted` once and then `waitForStop` once, in that order. After
 *   that it may call `polishingStarted` once, when transcription is done and polish is running.
 * - "Ended" means the keyboard ended the recording: stop tap, keyboard hidden, or keyboard closed.
 *   Ending always means "stop and transcribe" for the engine; the task never discards. An unknown id
 *   counts as ended.
 * - A request ended before `captureStarted` reached the keyboard is cancelled: its result is
 *   dropped by native. The task does not need to know; it delivers as usual.
 * - `captureStarted`, `polishingStarted` and `deliver` for an unknown or already delivered id are
 *   ignored, as is `polishingStarted` for a detached or cancelled request.
 * - None of these reject.
 */
declare class TophKeyboardModule extends NativeModule {
  /** Whether Toph Voice is turned on in Android's keyboard settings. Synchronous. */
  isEnabled(): boolean;
  /** Opens Android's keyboard settings. */
  openSettings(): void;
  /** Whether the keyboard has already ended this request. Asked right before opening the mic. */
  hasStopped(requestId: string): Promise<boolean>;
  /** Tells the keyboard the mic is recording for this request, so it can switch from "Starting…" to "Listening…". */
  captureStarted(requestId: string): Promise<void>;
  /** Tells the keyboard that transcription is done and polish is running, so it can switch from "Transcribing…" to "Polishing…". */
  polishingStarted(requestId: string): Promise<void>;
  /** Resolves when the keyboard ends this request, or at once if it already has. */
  waitForStop(requestId: string): Promise<void>;
  /** Hands the request's result to the keyboard: inserted, shown, or copied and toasted. */
  deliver(requestId: string, result: KeyboardResult): Promise<void>;
}

export const TophKeyboard = requireNativeModule<TophKeyboardModule>('TophKeyboard');
