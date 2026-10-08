/**
 * THROWAWAY MOCK (story #8 UI exploration). Presentation only: nothing here records, transcribes,
 * or talks to Android. It simulates the voice keyboard's phases from the program design so the
 * look and motion can be judged on a device. Delete the whole `mock/` folder and the
 * `app/mock/keyboard.tsx` route once the design is settled.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DictationPhase } from '../../dictation';

/** The keyboard's phases (program design §6.2), with the idle notices split out so each can be shown. */
export type MockPhase =
  | 'idle'
  | 'micMissing'
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'noSpeech'
  | 'failed'
  | 'busy'
  | 'noProvider';

export const MOCK_PHASES: readonly { value: MockPhase; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'micMissing', label: 'Mic missing' },
  { value: 'starting', label: 'Starting' },
  { value: 'listening', label: 'Listening' },
  { value: 'transcribing', label: 'Transcribing' },
  { value: 'noSpeech', label: 'No speech' },
  { value: 'failed', label: 'Failed' },
  { value: 'busy', label: 'Still finishing' },
  { value: 'noProvider', label: 'No provider' },
];

export type CaptionTone = 'muted' | 'error' | 'link';

export interface MockCopy {
  /** `null` while listening: the panel shows the clock instead, as Home does. */
  readonly headline: string | null;
  readonly caption: string;
  readonly tone: CaptionTone;
}

/**
 * Copy per phase. Where Home has the same moment, its wording is reused so the two surfaces read
 * as one product; the keyboard-only moments use the program design's wording (§7). Lines marked
 * "invented" exist only for this mock.
 */
export const MOCK_COPY: Record<MockPhase, MockCopy> = {
  idle: {
    headline: 'Tap to dictate',
    caption: 'Tap the mic and speak.',
    tone: 'muted',
  },
  micMissing: {
    headline: 'Microphone is off', // invented
    caption: 'Allow the microphone in Toph ›',
    tone: 'link',
  },
  starting: {
    headline: 'Starting',
    caption: 'Getting the mic ready. Tap to cancel.', // invented
    tone: 'muted',
  },
  listening: {
    headline: null,
    caption: 'Listening. Tap the orb when you are done.',
    tone: 'muted',
  },
  transcribing: {
    headline: 'Transcribing…',
    caption: "Sending what's left of your recording.",
    tone: 'muted',
  },
  noSpeech: {
    headline: "Didn't catch that.",
    caption: 'No speech came through. Tap the orb to try again.',
    tone: 'muted',
  },
  failed: {
    headline: "That didn't work.",
    caption: 'Incorrect API key provided. Check it in Toph.', // invented sample error
    tone: 'error',
  },
  busy: {
    headline: "That didn't work.",
    caption: "Couldn't start recording: Another dictation is still finishing.",
    tone: 'error',
  },
  noProvider: {
    headline: 'No provider yet', // invented
    caption: 'Connect a provider in Toph ›',
    tone: 'link',
  },
};

/** How Home's orb draws each keyboard phase. "Starting" has no Home equivalent; it rests. */
export function orbPhase(phase: MockPhase): DictationPhase {
  switch (phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
      return 'transcribing';
    default:
      return 'idle';
  }
}

/** Invented sample text, inserted into the fake host field. */
const SAMPLE_TRANSCRIPT = 'Running ten minutes late, grab us a table by the window.';

/** Simulated durations: a warm start, and a short tail upload after stop. */
const STARTING_MS = 900;
const TRANSCRIBING_MS = 1600;
const TOAST_MS = 2200;

export interface MockKeyboard {
  readonly phase: MockPhase;
  /** Set while listening, for the clock. */
  readonly startedAt: number | null;
  /** Whether Toph Voice is the keyboard on screen. */
  readonly shown: boolean;
  /** After an insert, Android switches back: the previous keyboard is on screen instead. */
  readonly previousShown: boolean;
  readonly fieldText: string;
  readonly toast: string | null;
  tapOrb(): void;
  tapCaption(): void;
  hide(): void;
  show(): void;
  jump(phase: MockPhase): void;
  reset(): void;
}

/**
 * The keyboard's phase machine (program design §6.2) on fake timers: tap → Starting → Listening,
 * tap → Transcribing → inserted and switched back. Hiding while Starting cancels silently; hiding
 * while Listening or Transcribing detaches, and the result is "copied" with a toast.
 */
export function useMockKeyboard(): MockKeyboard {
  const [phase, setPhase] = useState<MockPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [shown, setShown] = useState(true);
  const [previousShown, setPreviousShown] = useState(false);
  const [fieldText, setFieldText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the running request still belongs to the visible keyboard (program design D6).
  const attached = useRef(true);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const showToast = useCallback((text: string) => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current);
    }
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current);
      }
    },
    [clearTimer],
  );

  const deliver = useCallback(() => {
    timer.current = null;
    setStartedAt(null);
    if (attached.current) {
      setFieldText((text) => (text === '' ? SAMPLE_TRANSCRIPT : `${text} ${SAMPLE_TRANSCRIPT}`));
      setPhase('idle');
      setShown(false);
      setPreviousShown(true);
      return;
    }
    showToast('Transcript copied');
  }, [showToast]);

  const startRecording = useCallback(() => {
    clearTimer();
    attached.current = true;
    setPhase('starting');
    timer.current = setTimeout(() => {
      timer.current = null;
      setStartedAt(Date.now());
      setPhase('listening');
    }, STARTING_MS);
  }, [clearTimer]);

  const tapOrb = useCallback(() => {
    switch (phase) {
      case 'starting':
        clearTimer();
        setPhase('idle');
        return;
      case 'listening':
        setPhase('transcribing');
        timer.current = setTimeout(deliver, TRANSCRIBING_MS);
        return;
      case 'transcribing':
        return;
      case 'micMissing':
        showToast('Mock: re-checks the mic permission');
        return;
      default:
        startRecording();
    }
  }, [clearTimer, deliver, phase, showToast, startRecording]);

  const tapCaption = useCallback(() => {
    if (MOCK_COPY[phase].tone === 'link') {
      showToast('Mock: opens Toph');
    }
  }, [phase, showToast]);

  const hide = useCallback(() => {
    if (phase === 'starting') {
      clearTimer();
    } else if (phase === 'listening') {
      // Detached: recording stops now, transcription finishes in the background.
      attached.current = false;
      timer.current = setTimeout(deliver, TRANSCRIBING_MS);
    } else if (phase === 'transcribing') {
      attached.current = false;
    }
    setPhase('idle');
    setStartedAt(null);
    setShown(false);
    setPreviousShown(false);
  }, [clearTimer, deliver, phase]);

  const show = useCallback(() => {
    setShown(true);
    setPreviousShown(false);
  }, []);

  const jump = useCallback(
    (next: MockPhase) => {
      clearTimer();
      attached.current = true;
      setShown(true);
      setPreviousShown(false);
      setStartedAt(next === 'listening' ? Date.now() : null);
      setPhase(next);
    },
    [clearTimer],
  );

  const reset = useCallback(() => {
    jump('idle');
    setFieldText('');
    setToast(null);
  }, [jump]);

  return {
    phase,
    startedAt,
    shown,
    previousShown,
    fieldText,
    toast,
    tapOrb,
    tapCaption,
    hide,
    show,
    jump,
    reset,
  };
}
