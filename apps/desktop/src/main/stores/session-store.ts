import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { MAX_POLISH_RULE_PRESETS, type DashboardStats } from '@toph/desktop-contracts';

import {
  batchTranscripts,
  batchSourceRanges,
  dictionaryEntries,
  recordingSessions,
  polishRulePresets,
  providerUsageEvents,
  sessionOutputs,
  timelineRegions,
  transcriptionBatches,
  type BatchTranscript,
  type DictionaryEntry,
  type PolishRulePreset,
  type ProviderUsageEvent,
  type RecordingSession,
  type SessionOutput,
  type TranscriptionBatch,
} from '../db/schema';
import type { TophDataPaths } from '../paths';
import type { PlannedTranscriptionBatch, TimelineRegionDraft } from '../segmentation/types';

export interface RecordingSessionStore {
  createRecordingSession: () => Promise<RecordingSession>;
  getSession: (sessionId: string) => Promise<RecordingSession | null>;
  markRecorded: (options: {
    sessionId: string;
    endedAt: number;
    durationMs: number;
  }) => Promise<void>;
  markSegmenting: (sessionId: string) => Promise<void>;
  markSegmented: (sessionId: string) => Promise<void>;
  markPolishing: (sessionId: string) => Promise<void>;
  markNoSpeech: (sessionId: string) => Promise<void>;
  markFailed: (options: { sessionId: string; errorMessage: string }) => Promise<void>;
  // A recorded session with an error is recoverable because the raw WAV exists.
  markRecordedWithProcessingError: (options: {
    sessionId: string;
    errorMessage: string;
  }) => Promise<void>;
  markRecordingFailed: (options: {
    sessionId: string;
    errorMessage: string;
    endedAt?: number;
  }) => Promise<void>;
  markCancelled: (options: {
    sessionId: string;
    endedAt?: number;
    durationMs?: number;
  }) => Promise<void>;
  discardSessionArtifacts: (sessionId: string) => Promise<void>;
  setProcessingError: (options: { sessionId: string; errorMessage: string }) => Promise<void>;
  clearProcessingError: (sessionId: string) => Promise<void>;
  clearSegmentationData: (
    sessionId: string,
    options?: { preserveSelectedOutput?: boolean },
  ) => Promise<void>;
  insertTimelineRegions: (options: {
    sessionId: string;
    regions: TimelineRegionDraft[];
  }) => Promise<void>;
  insertPlannedBatches: (options: {
    sessionId: string;
    batches: PlannedTranscriptionBatch[];
  }) => Promise<void>;
  updateBatchDerivedAudioPaths: (
    updates: Array<{ batchId: string; derivedAudioPath: string }>,
  ) => Promise<void>;
  getTranscriptionBatch: (batchId: string) => Promise<TranscriptionBatch | null>;
  listTranscriptionBatchesForSession: (sessionId: string) => Promise<TranscriptionBatch[]>;
  markBatchTranscribing: (options: {
    batchId: string;
    attempts: number;
    startedAt: number;
  }) => Promise<void>;
  markBatchTranscribed: (options: { batchId: string; transcribedAt: number }) => Promise<void>;
  markBatchFailed: (options: {
    batchId: string;
    attempts: number;
    errorMessage: string;
  }) => Promise<void>;
  createBatchTranscript: (options: {
    transcript: BatchTranscript;
    usageEvent: ProviderUsageEvent;
  }) => Promise<void>;
  listOrderedBatchTranscriptTexts: (sessionId: string) => Promise<string[]>;
  createSessionOutput: (options: {
    output: SessionOutput;
    usageEvent?: ProviderUsageEvent;
  }) => Promise<void>;
  selectSessionOutput: (options: { sessionId: string; outputId: string }) => Promise<void>;
  listRecentRetainedSessions: (limit: number) => Promise<RetainedSessionRecord[]>;
  getDashboardStats: (options: {
    now: number;
    rollingWindowDays: number;
    typingWpm: number;
  }) => Promise<DashboardStats>;
  prepareSessionForRerun: (
    sessionId: string,
  ) => Promise<{ session: RecordingSession; outputId: string | null }>;
  removeSession: (sessionId: string) => Promise<void>;
  syncDefaultPolishRulePreset: (rulePreset: {
    id: string;
    title: string;
    description: string;
    body: string;
    bodyHash: string;
    sortOrder: number;
  }) => Promise<PolishRulePreset>;
  listPolishRulePresets: () => Promise<PolishRulePreset[]>;
  getPolishRulePreset: (rulePresetId: string) => Promise<PolishRulePreset | null>;
  createPolishRulePreset: (draft: {
    title: string;
    description: string;
    body: string;
    bodyHash: string;
  }) => Promise<PolishRulePreset>;
  updatePolishRulePreset: (
    id: string,
    draft: { title: string; description: string; body: string; bodyHash: string },
  ) => Promise<PolishRulePreset>;
  duplicatePolishRulePreset: (id: string) => Promise<PolishRulePreset>;
  reorderPolishRulePresets: (ids: string[]) => Promise<void>;
  deletePolishRulePreset: (id: string) => Promise<void>;
  listDictionaryEntries: () => Promise<DictionaryEntry[]>;
  createDictionaryEntry: (draft: {
    term: string;
    hint: string | null;
    enabled: boolean;
  }) => Promise<DictionaryEntry>;
  updateDictionaryEntry: (
    id: string,
    draft: { term: string; hint: string | null; enabled: boolean },
  ) => Promise<DictionaryEntry>;
  deleteDictionaryEntry: (id: string) => Promise<void>;
  getLegacyPolishSettings: () => Promise<{
    enabled: boolean;
    activeRulePresetId: string | null;
  } | null>;
  pruneRetainedSessions: () => Promise<void>;
  close: () => void;
}

export interface RetainedSessionRecord {
  session: RecordingSession;
  selectedOutput: SessionOutput | null;
  failedBatches: TranscriptionBatch[];
  rawAudioAvailable: boolean;
}

const retainedSessionCount = 10;
const retainableSessionStatuses = [
  'recorded',
  'segmented',
  'completed',
  'failed',
  'no_speech',
  'recording_failed',
] as const;

function createSessionId() {
  return `session_${Date.now()}_${randomUUID()}`;
}

function createRowId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomUUID()}`;
}

function createSessionStoreDatabase(options: { databasePath: string; migrationsFolder: string }): {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
} {
  const sqlite = new Database(options.databasePath);
  sqlite.pragma('journal_mode = WAL');

  const db = drizzle(sqlite);
  if (existsSync(join(options.migrationsFolder, 'meta', '_journal.json'))) {
    migrate(db, { migrationsFolder: options.migrationsFolder });
  }
  ensureCurrentWritableSchema(sqlite);

  return { sqlite, db };
}

function columnExists(sqlite: Database.Database, table: string, column: string) {
  return sqlite
    .prepare(`pragma table_info(${table})`)
    .all()
    .some((row) => {
      return typeof row === 'object' && row !== null && (row as { name?: unknown }).name === column;
    });
}

function hasIncompatibleGeneratedHistorySchema(sqlite: Database.Database) {
  return (
    columnExists(sqlite, 'batch_transcripts', 'estimated_billable_duration_ms') ||
    columnExists(sqlite, 'batch_transcripts', 'cost_usd_micros') ||
    columnExists(sqlite, 'session_outputs', 'cost_usd_micros')
  );
}

function resetGeneratedHistoryTables(sqlite: Database.Database) {
  sqlite.exec(`
    drop table if exists provider_usage_events;
    drop table if exists batch_source_ranges;
    drop table if exists batch_transcripts;
    drop table if exists transcription_batches;
    drop table if exists timeline_regions;
    drop table if exists session_outputs;
    drop table if exists recording_sessions;
  `);
}

function ensureCurrentWritableSchema(sqlite: Database.Database) {
  if (hasIncompatibleGeneratedHistorySchema(sqlite)) {
    resetGeneratedHistoryTables(sqlite);
  }

  sqlite.exec(`
    create table if not exists recording_sessions (
      id text primary key,
      created_at integer not null,
      started_at integer not null,
      ended_at integer,
      duration_ms integer,
      raw_audio_path text not null,
      status text not null,
      selected_output_id text,
      error_message text
    );

    create table if not exists timeline_regions (
      id text primary key,
      session_id text not null,
      sequence integer not null,
      kind text not null,
      start_ms integer not null,
      end_ms integer not null,
      confidence integer,
      created_live integer not null
    );

    create table if not exists transcription_batches (
      id text primary key,
      session_id text not null,
      sequence integer not null,
      status text not null,
      source_duration_ms integer not null,
      derived_audio_duration_ms integer not null,
      created_live integer not null,
      derived_audio_path text,
      created_at integer not null,
      transcription_attempts integer not null,
      transcription_started_at integer,
      transcribed_at integer,
      error_message text
    );

    create table if not exists batch_transcripts (
      id text primary key,
      batch_id text not null,
      provider text not null,
      model text,
      text text not null,
      created_at integer not null
    );

    create table if not exists session_outputs (
      id text primary key,
      session_id text not null,
      kind text not null,
      text text not null,
      source_output_id text,
      provider text,
      model text,
      rule_preset_id text,
      rule_preset_hash text,
      created_at integer not null
    );

    create table if not exists provider_usage_events (
      id text primary key,
      session_id text not null,
      operation_kind text not null,
      related_entity_kind text not null,
      related_entity_id text not null,
      provider text not null,
      model text,
      billing_mode text not null,
      audio_duration_ms integer,
      billable_duration_ms integer,
      input_tokens integer,
      cached_input_tokens integer,
      output_tokens integer,
      estimated_cost_usd_micros integer not null default 0,
      cost_source text not null default 'none',
      pricing_catalog_provider_id text,
      pricing_catalog_model_id text,
      provider_request_id text,
      provider_response_json text,
      created_at integer not null
    );

    create table if not exists polish_rule_presets (
      id text primary key,
      title text not null,
      description text not null,
      body text not null,
      body_hash text not null,
      is_builtin integer not null,
      sort_order integer not null,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists dictionary_entries (
      id text primary key,
      term text not null,
      hint text,
      enabled integer not null,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists batch_source_ranges (
      id text primary key,
      batch_id text not null,
      timeline_region_id text,
      sequence integer not null,
      source_start_ms integer not null,
      source_end_ms integer not null,
      derived_start_ms integer not null,
      derived_end_ms integer not null,
      reason text not null
    );
  `);

  if (!columnExists(sqlite, 'polish_rule_presets', 'description')) {
    sqlite.exec("alter table polish_rule_presets add column description text not null default ''");
  }
  if (!columnExists(sqlite, 'polish_rule_presets', 'sort_order')) {
    sqlite.exec('alter table polish_rule_presets add column sort_order integer not null default 0');
  }
}

export async function createRecordingSessionStore(options: {
  paths: TophDataPaths;
  migrationsFolder: string;
}): Promise<RecordingSessionStore> {
  await mkdir(dirname(options.paths.databasePath), { recursive: true });
  await mkdir(options.paths.recordingsDirectory, { recursive: true });

  const { sqlite, db } = createSessionStoreDatabase({
    databasePath: options.paths.databasePath,
    migrationsFolder: options.migrationsFolder,
  });

  const clearSessionGeneratedData = (
    sessionId: string,
    clearOptions: { keepOutputId?: string } = {},
  ) => {
    db.transaction(() => {
      const batches = db
        .select({ id: transcriptionBatches.id })
        .from(transcriptionBatches)
        .where(eq(transcriptionBatches.sessionId, sessionId))
        .all();
      const batchIds = batches.map((batch) => batch.id);

      if (batchIds.length > 0) {
        db.delete(batchTranscripts).where(inArray(batchTranscripts.batchId, batchIds)).run();
        db.delete(batchSourceRanges).where(inArray(batchSourceRanges.batchId, batchIds)).run();
      }

      db.delete(providerUsageEvents)
        .where(
          and(
            eq(providerUsageEvents.sessionId, sessionId),
            eq(providerUsageEvents.operationKind, 'transcription'),
          ),
        )
        .run();
      db.delete(providerUsageEvents)
        .where(
          clearOptions.keepOutputId
            ? and(
                eq(providerUsageEvents.sessionId, sessionId),
                eq(providerUsageEvents.relatedEntityKind, 'session_output'),
                ne(providerUsageEvents.relatedEntityId, clearOptions.keepOutputId),
              )
            : and(
                eq(providerUsageEvents.sessionId, sessionId),
                eq(providerUsageEvents.relatedEntityKind, 'session_output'),
              ),
        )
        .run();

      db.delete(transcriptionBatches).where(eq(transcriptionBatches.sessionId, sessionId)).run();
      db.delete(timelineRegions).where(eq(timelineRegions.sessionId, sessionId)).run();
      db.delete(sessionOutputs)
        .where(
          clearOptions.keepOutputId
            ? and(
                eq(sessionOutputs.sessionId, sessionId),
                ne(sessionOutputs.id, clearOptions.keepOutputId),
              )
            : eq(sessionOutputs.sessionId, sessionId),
        )
        .run();
    });
  };

  const clearSessionGeneratedArtifacts = async (
    session: RecordingSession,
    clearOptions: { keepOutputId?: string } = {},
  ) => {
    clearSessionGeneratedData(session.id, clearOptions);
    await rm(join(dirname(session.rawAudioPath), 'batches'), { recursive: true, force: true });
  };

  return {
    async createRecordingSession() {
      const now = Date.now();
      const id = createSessionId();
      const rawAudioPath = join(options.paths.recordingsDirectory, id, 'raw.wav');

      await mkdir(dirname(rawAudioPath), { recursive: true });

      const session = {
        id,
        createdAt: now,
        startedAt: now,
        endedAt: null,
        durationMs: null,
        rawAudioPath,
        status: 'recording' as const,
        selectedOutputId: null,
        errorMessage: null,
      };

      db.insert(recordingSessions).values(session).run();

      return session;
    },

    async getSession(sessionId) {
      return (
        db.select().from(recordingSessions).where(eq(recordingSessions.id, sessionId)).get() ?? null
      );
    },

    async markRecorded({ sessionId, endedAt, durationMs }) {
      db.update(recordingSessions)
        .set({
          endedAt,
          durationMs,
          status: 'recorded',
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markSegmenting(sessionId) {
      db.update(recordingSessions)
        .set({
          status: 'segmenting',
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markSegmented(sessionId) {
      db.update(recordingSessions)
        .set({
          status: 'segmented',
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markPolishing(sessionId) {
      db.update(recordingSessions)
        .set({
          status: 'polishing',
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markNoSpeech(sessionId) {
      db.update(recordingSessions)
        .set({
          status: 'no_speech',
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markFailed({ sessionId, errorMessage }) {
      db.update(recordingSessions)
        .set({
          status: 'failed',
          errorMessage,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markRecordedWithProcessingError({ sessionId, errorMessage }) {
      db.update(recordingSessions)
        .set({
          status: 'recorded',
          errorMessage,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markRecordingFailed({ sessionId, errorMessage, endedAt }) {
      db.update(recordingSessions)
        .set({
          endedAt: endedAt ?? Date.now(),
          status: 'recording_failed',
          errorMessage,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async markCancelled({ sessionId, endedAt, durationMs }) {
      const session = db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.id, sessionId))
        .get();
      if (!session) {
        return;
      }

      db.update(recordingSessions)
        .set({
          endedAt: session.endedAt ?? endedAt ?? Date.now(),
          durationMs: session.durationMs ?? durationMs ?? null,
          status: 'cancelled',
          selectedOutputId: null,
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async discardSessionArtifacts(sessionId) {
      const session = db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.id, sessionId))
        .get();
      if (!session) {
        return;
      }

      clearSessionGeneratedData(sessionId);
      await rm(dirname(session.rawAudioPath), { recursive: true, force: true });
    },

    async setProcessingError({ sessionId, errorMessage }) {
      db.update(recordingSessions)
        .set({ errorMessage })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async clearProcessingError(sessionId) {
      db.update(recordingSessions)
        .set({ errorMessage: null })
        .where(eq(recordingSessions.id, sessionId))
        .run();
    },

    async clearSegmentationData(sessionId, clearOptions) {
      const session = db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.id, sessionId))
        .get();
      if (!session) {
        return;
      }

      await clearSessionGeneratedArtifacts(session, {
        keepOutputId: clearOptions?.preserveSelectedOutput
          ? (session.selectedOutputId ?? undefined)
          : undefined,
      });
    },

    async insertTimelineRegions({ sessionId, regions }) {
      if (regions.length === 0) {
        return;
      }

      db.insert(timelineRegions)
        .values(
          regions.map((region) => ({
            id: region.id,
            sessionId,
            sequence: region.sequence,
            kind: region.kind,
            startMs: region.startMs,
            endMs: region.endMs,
            confidence: region.confidence,
            createdLive: region.createdLive,
          })),
        )
        .run();
    },

    async insertPlannedBatches({ sessionId, batches }) {
      if (batches.length === 0) {
        return;
      }

      db.transaction(() => {
        const now = Date.now();
        db.insert(transcriptionBatches)
          .values(
            batches.map((batch) => ({
              id: batch.id,
              sessionId,
              sequence: batch.sequence,
              status: 'planned' as const,
              sourceDurationMs: batch.sourceDurationMs,
              derivedAudioDurationMs: batch.derivedAudioDurationMs,
              createdLive: batch.createdLive,
              derivedAudioPath: null,
              createdAt: now,
              transcriptionAttempts: 0,
              transcriptionStartedAt: null,
              transcribedAt: null,
              errorMessage: null,
            })),
          )
          .run();

        const ranges = batches.flatMap((batch) => batch.sourceRanges);
        if (ranges.length === 0) {
          return;
        }

        db.insert(batchSourceRanges)
          .values(
            ranges.map((range) => ({
              id: range.id,
              batchId: range.batchId,
              timelineRegionId: range.timelineRegionId,
              sequence: range.sequence,
              sourceStartMs: range.sourceStartMs,
              sourceEndMs: range.sourceEndMs,
              derivedStartMs: range.derivedStartMs,
              derivedEndMs: range.derivedEndMs,
              reason: range.reason,
            })),
          )
          .run();
      });
    },

    async updateBatchDerivedAudioPaths(updates) {
      db.transaction(() => {
        for (const update of updates) {
          db.update(transcriptionBatches)
            .set({ derivedAudioPath: update.derivedAudioPath })
            .where(eq(transcriptionBatches.id, update.batchId))
            .run();
        }
      });
    },

    async getTranscriptionBatch(batchId) {
      return (
        db.select().from(transcriptionBatches).where(eq(transcriptionBatches.id, batchId)).get() ??
        null
      );
    },

    async listTranscriptionBatchesForSession(sessionId) {
      return db
        .select()
        .from(transcriptionBatches)
        .where(eq(transcriptionBatches.sessionId, sessionId))
        .all();
    },

    async markBatchTranscribing({ batchId, attempts, startedAt }) {
      db.update(transcriptionBatches)
        .set({
          status: 'transcribing',
          transcriptionAttempts: attempts,
          transcriptionStartedAt: startedAt,
          errorMessage: null,
        })
        .where(eq(transcriptionBatches.id, batchId))
        .run();
    },

    async markBatchTranscribed({ batchId, transcribedAt }) {
      db.update(transcriptionBatches)
        .set({
          status: 'transcribed',
          transcribedAt,
          errorMessage: null,
        })
        .where(eq(transcriptionBatches.id, batchId))
        .run();
    },

    async markBatchFailed({ batchId, attempts, errorMessage }) {
      db.update(transcriptionBatches)
        .set({
          status: 'failed',
          transcriptionAttempts: attempts,
          errorMessage,
        })
        .where(eq(transcriptionBatches.id, batchId))
        .run();
    },

    async createBatchTranscript({ transcript, usageEvent }) {
      db.transaction(() => {
        db.insert(batchTranscripts).values(transcript).run();
        db.insert(providerUsageEvents).values(usageEvent).run();
      });
    },

    async listOrderedBatchTranscriptTexts(sessionId) {
      return db
        .select({ text: batchTranscripts.text })
        .from(transcriptionBatches)
        .innerJoin(batchTranscripts, eq(batchTranscripts.batchId, transcriptionBatches.id))
        .where(eq(transcriptionBatches.sessionId, sessionId))
        .orderBy(transcriptionBatches.sequence)
        .all()
        .map((row) => row.text);
    },

    async createSessionOutput({ output, usageEvent }) {
      db.transaction(() => {
        db.delete(providerUsageEvents)
          .where(
            and(
              eq(providerUsageEvents.relatedEntityKind, 'session_output'),
              eq(providerUsageEvents.relatedEntityId, output.id),
            ),
          )
          .run();
        db.insert(sessionOutputs)
          .values(output)
          .onConflictDoUpdate({
            target: sessionOutputs.id,
            set: {
              sessionId: output.sessionId,
              kind: output.kind,
              text: output.text,
              sourceOutputId: output.sourceOutputId,
              provider: output.provider,
              model: output.model,
              rulePresetId: output.rulePresetId,
              rulePresetHash: output.rulePresetHash,
              createdAt: output.createdAt,
            },
          })
          .run();
        if (usageEvent) {
          db.insert(providerUsageEvents)
            .values(usageEvent)
            .onConflictDoUpdate({
              target: providerUsageEvents.id,
              set: usageEvent,
            })
            .run();
        }
      });
    },

    async selectSessionOutput({ sessionId, outputId }) {
      db.transaction(() => {
        db.update(recordingSessions)
          .set({
            status: 'completed',
            selectedOutputId: outputId,
            errorMessage: null,
          })
          .where(eq(recordingSessions.id, sessionId))
          .run();
      });
    },

    async listRecentRetainedSessions(limit) {
      const rows = db
        .select({
          session: recordingSessions,
          selectedOutput: sessionOutputs,
        })
        .from(recordingSessions)
        .leftJoin(sessionOutputs, eq(recordingSessions.selectedOutputId, sessionOutputs.id))
        .where(inArray(recordingSessions.status, retainableSessionStatuses))
        .orderBy(desc(recordingSessions.createdAt))
        .all();

      return rows
        .map((row) => ({
          session: row.session,
          selectedOutput: row.selectedOutput,
          failedBatches: db
            .select()
            .from(transcriptionBatches)
            .where(
              and(
                eq(transcriptionBatches.sessionId, row.session.id),
                eq(transcriptionBatches.status, 'failed'),
              ),
            )
            .orderBy(asc(transcriptionBatches.sequence))
            .all(),
          rawAudioAvailable: existsSync(row.session.rawAudioPath),
        }))
        .filter((row) => row.rawAudioAvailable)
        .slice(0, limit);
    },

    async getDashboardStats({ now, rollingWindowDays, typingWpm }) {
      const threshold = now - rollingWindowDays * 24 * 60 * 60 * 1000;
      const selectedOutputs = sqlite
        .prepare(`
          select so.id, so.text, so.session_id as sessionId
          from session_outputs so
          inner join recording_sessions rs on rs.selected_output_id = so.id
          where rs.status = 'completed' and so.created_at >= ?
        `)
        .all(threshold) as Array<{
        id: string;
        text: string;
        sessionId: string;
      }>;

      const sessionIds = selectedOutputs.map((output) => output.sessionId);
      const outputIds = selectedOutputs.map((output) => output.id);
      let derivedAudioDurationMs = 0;
      let meteredSpendUsdMicros = 0;
      let subscriptionEstimatedCostUsdMicros = 0;
      let totalEstimatedCostUsdMicros = 0;
      let costEstimateIncomplete = false;
      if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => '?').join(',');
        const durationRow = sqlite
          .prepare(
            `select coalesce(sum(derived_audio_duration_ms), 0) as total from transcription_batches where session_id in (${placeholders})`,
          )
          .get(...sessionIds) as { total: number } | undefined;
        derivedAudioDurationMs = durationRow?.total ?? 0;
        const usageFilters = [
          `(operation_kind = 'transcription' and session_id in (${placeholders}))`,
          outputIds.length > 0
            ? `(operation_kind = 'inference' and related_entity_kind = 'session_output' and related_entity_id in (${outputIds.map(() => '?').join(',')}))`
            : null,
        ]
          .filter(Boolean)
          .join(' or ');
        const usageRows = sqlite
          .prepare(`
            select
              billing_mode as billingMode,
              cost_source as costSource,
              coalesce(sum(estimated_cost_usd_micros), 0) as total
            from provider_usage_events
            where ${usageFilters}
            group by billing_mode, cost_source
          `)
          .all(...sessionIds, ...outputIds) as Array<{
          billingMode: string;
          costSource: string;
          total: number;
        }>;
        for (const row of usageRows) {
          totalEstimatedCostUsdMicros += row.total;
          if (row.billingMode === 'metered') {
            meteredSpendUsdMicros += row.total;
          }
          if (row.billingMode === 'subscription') {
            subscriptionEstimatedCostUsdMicros += row.total;
          }
          if (
            (row.billingMode === 'metered' || row.billingMode === 'unknown') &&
            row.costSource === 'none'
          ) {
            costEstimateIncomplete = true;
          }
        }
      }

      const words = selectedOutputs.reduce((total, output) => {
        const trimmed = output.text.trim();
        return total + (trimmed ? trimmed.split(/\s+/).length : 0);
      }, 0);
      const averageSpokenWpm =
        words > 0 && derivedAudioDurationMs > 0 ? words / (derivedAudioDurationMs / 60_000) : null;
      const typingMinutes = words / typingWpm;
      const speakingMinutes = averageSpokenWpm ? words / averageSpokenWpm : 0;

      return {
        rollingWindowDays,
        words,
        averageSpokenWpm,
        timeSavedMinutes: Math.max(0, typingMinutes - speakingMinutes),
        meteredSpendUsdMicros,
        subscriptionEstimatedCostUsdMicros,
        totalEstimatedCostUsdMicros,
        costEstimateIncomplete,
      };
    },

    async prepareSessionForRerun(sessionId) {
      const row = db
        .select({ session: recordingSessions, output: sessionOutputs })
        .from(recordingSessions)
        .leftJoin(sessionOutputs, eq(recordingSessions.selectedOutputId, sessionOutputs.id))
        .where(eq(recordingSessions.id, sessionId))
        .get();
      if (!row) {
        throw new Error(`Session ${sessionId} is not available.`);
      }
      if (row.session.status === 'removed' || row.session.status === 'cancelled') {
        throw new Error(`Session ${sessionId} no longer has retained audio.`);
      }
      if (!existsSync(row.session.rawAudioPath)) {
        throw new Error(`Session ${sessionId} no longer has retained audio.`);
      }

      const outputId = row.output?.id ?? null;
      await clearSessionGeneratedArtifacts(
        row.session,
        outputId ? { keepOutputId: outputId } : undefined,
      );
      db.update(recordingSessions)
        .set({
          status: 'recorded',
          selectedOutputId: outputId,
          errorMessage: null,
        })
        .where(eq(recordingSessions.id, row.session.id))
        .run();

      return {
        session: {
          ...row.session,
          status: 'recorded',
          selectedOutputId: outputId,
          errorMessage: null,
        },
        outputId,
      };
    },

    async removeSession(sessionId) {
      const row = db
        .select({ session: recordingSessions })
        .from(recordingSessions)
        .where(eq(recordingSessions.id, sessionId))
        .get();
      if (!row) {
        return;
      }

      clearSessionGeneratedData(row.session.id);
      await rm(dirname(row.session.rawAudioPath), { recursive: true, force: true });
      db.update(recordingSessions)
        .set({ status: 'removed', selectedOutputId: null, errorMessage: null })
        .where(eq(recordingSessions.id, row.session.id))
        .run();
    },

    async syncDefaultPolishRulePreset(rulePreset) {
      const now = Date.now();
      const existing = db
        .select()
        .from(polishRulePresets)
        .where(eq(polishRulePresets.id, rulePreset.id))
        .get();
      if (!existing) {
        const inserted = {
          id: rulePreset.id,
          title: rulePreset.title,
          description: rulePreset.description,
          body: rulePreset.body,
          bodyHash: rulePreset.bodyHash,
          isBuiltin: false,
          sortOrder: rulePreset.sortOrder,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(polishRulePresets).values(inserted).run();
        return inserted;
      }

      if (
        existing.description.trim().length === 0 ||
        (existing.sortOrder === 0 && rulePreset.sortOrder > 0)
      ) {
        const updated = {
          ...existing,
          description:
            existing.description.trim().length === 0
              ? rulePreset.description
              : existing.description,
          sortOrder:
            existing.sortOrder === 0 && rulePreset.sortOrder > 0
              ? rulePreset.sortOrder
              : existing.sortOrder,
          updatedAt: now,
        };
        db.update(polishRulePresets)
          .set({
            description: updated.description,
            sortOrder: updated.sortOrder,
            updatedAt: updated.updatedAt,
          })
          .where(eq(polishRulePresets.id, rulePreset.id))
          .run();
        return updated;
      }

      return existing;
    },

    async listPolishRulePresets() {
      return db
        .select()
        .from(polishRulePresets)
        .orderBy(asc(polishRulePresets.sortOrder), asc(polishRulePresets.title))
        .all();
    },

    async getPolishRulePreset(rulePresetId) {
      return (
        db.select().from(polishRulePresets).where(eq(polishRulePresets.id, rulePresetId)).get() ??
        null
      );
    },

    async createPolishRulePreset(draft) {
      const existingCount = db.select().from(polishRulePresets).all().length;
      if (existingCount >= MAX_POLISH_RULE_PRESETS) {
        throw new Error(`Only ${MAX_POLISH_RULE_PRESETS} writing rules can exist at once.`);
      }

      const now = Date.now();
      const preset = {
        id: createRowId('rule_preset'),
        title: draft.title,
        description: draft.description,
        body: draft.body,
        bodyHash: draft.bodyHash,
        isBuiltin: false,
        sortOrder: existingCount,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(polishRulePresets).values(preset).run();
      return preset;
    },

    async updatePolishRulePreset(id, draft) {
      const existing = db
        .select()
        .from(polishRulePresets)
        .where(eq(polishRulePresets.id, id))
        .get();
      if (!existing) {
        throw new Error(`Polish rule preset "${id}" is not available.`);
      }

      const updated = {
        ...existing,
        title: draft.title,
        description: draft.description,
        body: draft.body,
        bodyHash: draft.bodyHash,
        updatedAt: Date.now(),
      };
      db.update(polishRulePresets)
        .set({
          title: updated.title,
          description: updated.description,
          body: updated.body,
          bodyHash: updated.bodyHash,
          updatedAt: updated.updatedAt,
        })
        .where(eq(polishRulePresets.id, id))
        .run();
      return updated;
    },

    async duplicatePolishRulePreset(id) {
      const existing = db
        .select()
        .from(polishRulePresets)
        .where(eq(polishRulePresets.id, id))
        .get();
      if (!existing) {
        throw new Error(`Polish rule preset "${id}" is not available.`);
      }
      const existingCount = db.select().from(polishRulePresets).all().length;
      if (existingCount >= MAX_POLISH_RULE_PRESETS) {
        throw new Error(`Only ${MAX_POLISH_RULE_PRESETS} writing rules can exist at once.`);
      }

      const now = Date.now();
      const preset = {
        id: createRowId('rule_preset'),
        title: `${existing.title} copy`,
        description: existing.description,
        body: existing.body,
        bodyHash: existing.bodyHash,
        isBuiltin: false,
        sortOrder: existingCount,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(polishRulePresets).values(preset).run();
      return preset;
    },

    async reorderPolishRulePresets(ids) {
      const existing = db
        .select()
        .from(polishRulePresets)
        .orderBy(asc(polishRulePresets.sortOrder))
        .all();
      const existingIds = existing.map((preset) => preset.id);
      const uniqueIds = new Set(ids);
      if (
        ids.length !== existingIds.length ||
        uniqueIds.size !== ids.length ||
        ids.some((id) => !existingIds.includes(id))
      ) {
        throw new Error('Rule order must include every writing rule exactly once.');
      }

      db.transaction(() => {
        ids.forEach((id, index) => {
          db.update(polishRulePresets)
            .set({ sortOrder: index, updatedAt: Date.now() })
            .where(eq(polishRulePresets.id, id))
            .run();
        });
      });
    },

    async deletePolishRulePreset(id) {
      const existing = db
        .select()
        .from(polishRulePresets)
        .orderBy(asc(polishRulePresets.sortOrder))
        .all();
      if (!existing.some((preset) => preset.id === id)) {
        return;
      }
      if (existing.length <= 1) {
        throw new Error('At least one writing rule must remain.');
      }

      db.transaction(() => {
        db.delete(polishRulePresets).where(eq(polishRulePresets.id, id)).run();
        existing
          .filter((preset) => preset.id !== id)
          .forEach((preset, index) => {
            db.update(polishRulePresets)
              .set({ sortOrder: index })
              .where(eq(polishRulePresets.id, preset.id))
              .run();
          });
      });
    },

    async listDictionaryEntries() {
      return db.select().from(dictionaryEntries).orderBy(asc(dictionaryEntries.term)).all();
    },

    async createDictionaryEntry(draft) {
      const now = Date.now();
      const entry = {
        id: createRowId('dictionary_entry'),
        term: draft.term,
        hint: draft.hint,
        enabled: draft.enabled,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(dictionaryEntries).values(entry).run();
      return entry;
    },

    async updateDictionaryEntry(id, draft) {
      const existing = db
        .select()
        .from(dictionaryEntries)
        .where(eq(dictionaryEntries.id, id))
        .get();
      if (!existing) {
        throw new Error(`Dictionary entry "${id}" is not available.`);
      }

      const updated = {
        ...existing,
        term: draft.term,
        hint: draft.hint,
        enabled: draft.enabled,
        updatedAt: Date.now(),
      };
      db.update(dictionaryEntries)
        .set({
          term: updated.term,
          hint: updated.hint,
          enabled: updated.enabled,
          updatedAt: updated.updatedAt,
        })
        .where(eq(dictionaryEntries.id, id))
        .run();
      return updated;
    },

    async deleteDictionaryEntry(id) {
      db.delete(dictionaryEntries).where(eq(dictionaryEntries.id, id)).run();
    },

    async getLegacyPolishSettings() {
      const table = sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'polish_settings'")
        .get();
      if (!table) {
        return null;
      }

      const row = sqlite
        .prepare('select enabled, active_prompt_id from polish_settings where id = ?')
        .get('polish') as { enabled?: unknown; active_prompt_id?: unknown } | undefined;
      if (!row || typeof row.active_prompt_id !== 'string') {
        return null;
      }

      return {
        enabled: Boolean(row.enabled),
        activeRulePresetId: row.active_prompt_id,
      };
    },

    async pruneRetainedSessions() {
      const terminalSessions = db
        .select()
        .from(recordingSessions)
        .where(inArray(recordingSessions.status, retainableSessionStatuses))
        .orderBy(desc(recordingSessions.endedAt), desc(recordingSessions.createdAt))
        .all();

      const sessionsToPrune = terminalSessions.slice(retainedSessionCount);
      if (sessionsToPrune.length === 0) {
        return;
      }

      await Promise.all(
        sessionsToPrune.map(async (session) => {
          await rm(dirname(session.rawAudioPath), { recursive: true, force: true });
          db.update(recordingSessions)
            .set({ status: 'removed' })
            .where(eq(recordingSessions.id, session.id))
            .run();
        }),
      );
    },

    close() {
      sqlite.close();
    },
  };
}
