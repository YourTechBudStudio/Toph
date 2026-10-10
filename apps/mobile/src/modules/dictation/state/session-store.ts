import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { ProviderConfig } from '../../provider';
import type { DictationRun } from '../engine/dictation';
import { describeError } from '../engine/dictation';
import type { DictationOutcome } from '../engine/transcription';

/** Where an in-app dictation stands. `done` and `failed` keep the outcome on screen until the next start. */
export type DictationPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'polishing'
  | 'done'
  | 'failed';

/** What the store needs from other capabilities. `state/session.ts` passes the real ones; tests pass fakes. */
export interface SessionStoreDeps {
  readProviderConfig(): ProviderConfig | null;
  startDictation(config: ProviderConfig): Promise<DictationRun>;
}

export interface SessionState {
  readonly phase: DictationPhase;
  /** Set while a run is held, for the clock. */
  readonly startedAt: number | null;
  /** Set exactly when the phase is `done` or `failed`. */
  readonly outcome: DictationOutcome | null;
  start(): void;
  stop(): void;
  cancel(): void;
}

type Ending = 'stop' | 'discard';

/** The one run the store holds, from an accepted start until its teardown has settled. */
interface HeldRun {
  readonly startedAt: number;
  ending: Ending | null;
  end(ending: Ending): void;
  readonly ended: Promise<Ending>;
}

function holdRun(startedAt: number): HeldRun {
  let resolve: (ending: Ending) => void = () => undefined;
  const ended = new Promise<Ending>((settle) => {
    resolve = settle;
  });
  const run: HeldRun = {
    startedAt,
    ending: null,
    end(ending) {
      run.ending = ending;
      resolve(ending);
    },
    ended,
  };
  return run;
}

/**
 * The in-app dictation session. It holds at most one run, from the moment `start()` is accepted
 * until that run's mic, subscription, uploads and files are released, so a new start never overlaps
 * the previous run. The phase leaves `listening`, `transcribing` or `polishing` only when the run is
 * released, so `onPolishing`, which the engine calls while the run is held, never overwrites a later
 * phase. Stop or Discard during a pending start is recorded and applied once the start settles.
 */
export function createSessionStore(deps: SessionStoreDeps): UseBoundStore<StoreApi<SessionState>> {
  let held: HeldRun | null = null;

  /** One dictation from start to release. `null` means discarded. */
  async function dictate(run: HeldRun): Promise<DictationOutcome | null> {
    const config = deps.readProviderConfig();
    if (config === null) {
      return { kind: 'failed', message: 'Connect a provider first.' };
    }
    let dictation: DictationRun;
    try {
      dictation = await deps.startDictation(config);
    } catch (error) {
      return run.ending === 'discard'
        ? null
        : { kind: 'failed', message: `Couldn't start recording: ${describeError(error)}` };
    }
    if ((await run.ended) === 'discard') {
      await dictation.discard();
      return null;
    }
    // The engine saves the run to history; the outcome carries the selected text.
    return await dictation.stop({ onPolishing: () => store.setState({ phase: 'polishing' }) });
  }

  const store = create<SessionState>()((set) => ({
    phase: 'idle',
    startedAt: null,
    outcome: null,
    start: () => {
      if (held !== null) {
        return; // a run, or its teardown, is still in progress
      }
      const run = holdRun(Date.now());
      held = run;
      set({ phase: 'listening', startedAt: run.startedAt, outcome: null });
      void dictate(run)
        // Defensive: the engine's stop and discard never reject.
        .catch(
          (error: unknown): DictationOutcome => ({ kind: 'failed', message: describeError(error) }),
        )
        .then((outcome) => {
          held = null;
          set(
            outcome === null
              ? { phase: 'idle', startedAt: null, outcome: null }
              : { phase: outcome.kind === 'failed' ? 'failed' : 'done', startedAt: null, outcome },
          );
        });
    },
    stop: () => {
      if (held === null || held.ending !== null) {
        return;
      }
      set({ phase: 'transcribing' }); // `polishing` follows if the engine reports it
      held.end('stop');
    },
    cancel: () => {
      if (held === null || held.ending !== null) {
        return;
      }
      // The phase stays `listening` for the short teardown; further taps are ignored.
      held.end('discard');
    },
  }));
  return store;
}
