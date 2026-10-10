import { desc, eq, inArray, sql } from 'drizzle-orm';

import {
  recordingSessions,
  retainableSessionStatuses,
  retainedSessionCount,
  sessionOutputs,
  type SessionOutputStore,
} from '@toph/dictation-core';

import { appFile } from '../../../storage/app-files';
import { openDatabase } from '../../../storage/database';
import { reloadHistory } from './history';

/**
 * History's writes, with desktop's store method names and `set` values. Each method is one
 * statement (prune is a short loop of them); errors propagate, and the dictation engine decides
 * which writes a dictation depends on.
 */
export interface SessionRecords extends Pick<
  SessionOutputStore,
  'createSessionOutput' | 'selectSessionOutput'
> {
  /** Resolves once the database is usable; rejects with the reason otherwise. */
  ready(): Promise<void>;
  /** Inserts the row as `recording`, with `createdAt = startedAt`, `transcriptionProviderId: 'openai'`. */
  createRecordingSession(input: {
    id: string;
    startedAt: number;
    rawAudioPath: string;
    transcriptionModel: string;
  }): Promise<void>;
  markRecorded(input: { sessionId: string; endedAt: number; durationMs: number }): Promise<void>;
  markNoSpeech(sessionId: string): Promise<void>;
  markFailed(input: { sessionId: string; errorMessage: string }): Promise<void>;
  /** `cancelled`, `endedAt` (if unset), `selectedOutputId = null`, `errorMessage = null`, as desktop. */
  markCancelled(sessionId: string): Promise<void>;
  /** Desktop's prune with core's retention constants, then reloads the history list. */
  pruneAndRefresh(): Promise<void>;
}

/** A plain object of closures with no `this`, so the engine can pass its methods on individually. */
export const sessionRecords: SessionRecords = {
  async ready() {
    await openDatabase();
  },

  async createRecordingSession({ id, startedAt, rawAudioPath, transcriptionModel }) {
    const db = await openDatabase();
    db.insert(recordingSessions)
      .values({
        id,
        createdAt: startedAt,
        startedAt,
        endedAt: null,
        durationMs: null,
        rawAudioPath,
        transcriptionProviderId: 'openai',
        transcriptionModel,
        status: 'recording',
        selectedOutputId: null,
        errorMessage: null,
      })
      .run();
  },

  async markRecorded({ sessionId, endedAt, durationMs }) {
    const db = await openDatabase();
    db.update(recordingSessions)
      .set({ endedAt, durationMs, status: 'recorded', errorMessage: null })
      .where(eq(recordingSessions.id, sessionId))
      .run();
  },

  async markNoSpeech(sessionId) {
    const db = await openDatabase();
    db.update(recordingSessions)
      .set({ status: 'no_speech', errorMessage: null })
      .where(eq(recordingSessions.id, sessionId))
      .run();
  },

  async markFailed({ sessionId, errorMessage }) {
    const db = await openDatabase();
    db.update(recordingSessions)
      .set({ status: 'failed', errorMessage })
      .where(eq(recordingSessions.id, sessionId))
      .run();
  },

  async markCancelled(sessionId) {
    const db = await openDatabase();
    // Desktop reads the row first only to merge optional arguments that this signature lacks.
    db.update(recordingSessions)
      .set({
        endedAt: sql`coalesce(${recordingSessions.endedAt}, ${Date.now()})`,
        status: 'cancelled',
        selectedOutputId: null,
        errorMessage: null,
      })
      .where(eq(recordingSessions.id, sessionId))
      .run();
  },

  // The usage event and rerun flag are ignored: mobile records no cost and has no reruns.
  async createSessionOutput({ output }) {
    const db = await openDatabase();
    db.insert(sessionOutputs).values(output).run();
  },

  async selectSessionOutput({ sessionId, outputId }) {
    const db = await openDatabase();
    db.update(recordingSessions)
      .set({ status: 'completed', selectedOutputId: outputId, errorMessage: null })
      .where(eq(recordingSessions.id, sessionId))
      .run();
  },

  async pruneAndRefresh() {
    try {
      const db = await openDatabase();
      const retained = db
        .select({ id: recordingSessions.id, rawAudioPath: recordingSessions.rawAudioPath })
        .from(recordingSessions)
        .where(inArray(recordingSessions.status, retainableSessionStatuses))
        .orderBy(desc(recordingSessions.endedAt), desc(recordingSessions.createdAt))
        .all();
      // One at a time: a delete that throws stops here, and the rest are retried at the next run.
      for (const session of retained.slice(retainedSessionCount)) {
        // The audio goes first, as on desktop; the row and its outputs are kept as `removed`.
        const directory = appFile(session.rawAudioPath).parentDirectory;
        if (directory.exists) {
          directory.delete();
        }
        db.update(recordingSessions)
          .set({ status: 'removed' })
          .where(eq(recordingSessions.id, session.id))
          .run();
      }
    } finally {
      await reloadHistory();
    }
  },
};
