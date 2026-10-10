import { desc, inArray } from 'drizzle-orm';
import { create } from 'zustand';

import { recordingSessions, retainableSessionStatuses, sessionOutputs } from '@toph/dictation-core';

import { appFile } from '../../../storage/app-files';
import { openDatabase } from '../../../storage/database';
import { toDictation, type Dictation } from './dictation-view';

interface HistoryState {
  /** The first read has settled, whether or not it worked. */
  readonly loaded: boolean;
  /** Retained dictations whose audio still exists, newest first. */
  readonly dictations: readonly Dictation[];
}

const useHistoryStore = create<HistoryState>()(() => ({ loaded: false, dictations: [] }));

/**
 * Re-reads the list, as desktop lists recent sessions: retainable statuses whose `raw.wav` still
 * exists, newest first. Rejects when the database is unusable.
 */
export async function reloadHistory(): Promise<void> {
  const db = await openDatabase();
  const sessions = db
    .select()
    .from(recordingSessions)
    .where(inArray(recordingSessions.status, retainableSessionStatuses))
    .orderBy(desc(recordingSessions.createdAt))
    .all()
    .filter((session) => appFile(session.rawAudioPath).exists);
  const outputs =
    sessions.length === 0
      ? []
      : db
          .select()
          .from(sessionOutputs)
          .where(
            inArray(
              sessionOutputs.sessionId,
              sessions.map((session) => session.id),
            ),
          )
          .all();
  useHistoryStore.setState({
    loaded: true,
    dictations: sessions.map((session) =>
      toDictation(
        session,
        outputs.filter((output) => output.sessionId === session.id),
      ),
    ),
  });
}

let loading: Promise<void> | undefined;

/** The first read, once per JS runtime. Never rejects: on failure it logs and shows an empty list. */
export function loadHistory(): Promise<void> {
  loading ??= reloadHistory().catch((error: unknown) => {
    console.warn('[toph:history] could not load history', error);
    useHistoryStore.setState({ loaded: true, dictations: [] });
  });
  return loading;
}

export function useHistory(): { loaded: boolean; dictations: readonly Dictation[] } {
  const loaded = useHistoryStore((state) => state.loaded);
  const dictations = useHistoryStore((state) => state.dictations);
  return { loaded, dictations };
}

export function useDictation(id: string): Dictation | undefined {
  return useHistoryStore((state) => state.dictations.find((dictation) => dictation.id === id));
}
