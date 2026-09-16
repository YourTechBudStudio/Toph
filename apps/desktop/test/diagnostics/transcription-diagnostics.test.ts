import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createTranscriptionDiagnostics } =
  await import('../../src/main/diagnostics/transcription-diagnostics.ts');

async function withTempDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'toph-diagnostics-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readLines(filePath: string) {
  const contents = await readFile(filePath, 'utf8');
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('records events as timestamped JSON lines in handover order', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'nested', 'transcription.jsonl');
    let clock = 1_000;
    const diagnostics = createTranscriptionDiagnostics({
      filePath,
      sensitiveRoots: [],
      now: () => (clock += 1),
    });

    diagnostics.record({
      kind: 'batches_handed_over',
      sessionId: 'session-1',
      batchIds: ['batch-1', 'batch-2'],
      origin: 'live',
    });
    diagnostics.record({ kind: 'batch_received', batchId: 'batch-1', resetAttempts: false });
    diagnostics.record({
      kind: 'batch_task_created',
      sessionId: 'session-1',
      batchId: 'batch-1',
    });
    await diagnostics.flush();

    const lines = await readLines(filePath);
    assert.deepEqual(
      lines.map((line) => line.kind),
      ['batches_handed_over', 'batch_received', 'batch_task_created'],
    );
    assert.deepEqual(lines[0].batchIds, ['batch-1', 'batch-2']);
    assert.deepEqual(
      lines.map((line) => line.at),
      [1_001, 1_002, 1_003],
    );
  });
});

test('redacts filesystem paths out of failure messages', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    const diagnostics = createTranscriptionDiagnostics({
      filePath,
      sensitiveRoots: ['/Users/someone/.toph'],
    });

    diagnostics.record({
      kind: 'batch_failed',
      sessionId: 'session-1',
      batchId: 'batch-1',
      attempts: 3,
      message: 'ENOENT: /Users/someone/.toph/recordings/session-1/batches/batch-0001.wav',
    });
    await diagnostics.flush();

    const [line] = await readLines(filePath);
    assert.equal(String(line.message).includes('/Users/someone'), false);
    assert.match(String(line.message), /redacted-path/);
  });
});

test('rolls the log over once it exceeds its size bound', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    await writeFile(filePath, `${'x'.repeat(200)}\n`, 'utf8');
    const diagnostics = createTranscriptionDiagnostics({
      filePath,
      sensitiveRoots: [],
      maxBytes: 100,
    });

    diagnostics.record({ kind: 'batch_received', batchId: 'batch-1', resetAttempts: false });
    await diagnostics.flush();

    const lines = await readLines(filePath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].kind, 'batch_received');
    assert.match(await readFile(`${filePath}.1`, 'utf8'), /^x{200}/);
  });
});

test('a write failure never rejects into the caller', async () => {
  await withTempDirectory(async (directory) => {
    // A path whose parent is a file, so `mkdir` and `appendFile` both fail.
    const blocker = join(directory, 'blocker');
    await writeFile(blocker, 'not a directory', 'utf8');
    const diagnostics = createTranscriptionDiagnostics({
      filePath: join(blocker, 'transcription.jsonl'),
      sensitiveRoots: [],
    });

    const originalConsoleError = console.error;
    const reported: unknown[] = [];
    console.error = (...args: unknown[]) => {
      reported.push(args[0]);
    };
    try {
      assert.doesNotThrow(() => {
        diagnostics.record({ kind: 'batch_received', batchId: 'batch-1', resetAttempts: false });
        diagnostics.record({ kind: 'batch_received', batchId: 'batch-2', resetAttempts: false });
      });
      await assert.doesNotReject(() => diagnostics.flush());
    } finally {
      console.error = originalConsoleError;
    }

    assert.deepEqual(reported, ['Toph could not write transcription diagnostics.']);
  });
});

test('timestamps are fixed when the event is recorded, not when the write lands', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    let clock = 1_000;
    const diagnostics = createTranscriptionDiagnostics({
      filePath,
      sensitiveRoots: [],
      now: () => clock,
    });

    // Both events are recorded in this tick; the queued writes cannot reach the filesystem until
    // it ends. Advancing the clock before flushing therefore separates "stamped when recorded"
    // from "stamped when written" - the distinction that decides whether a gap in the trail is a
    // gap between events or between disk writes.
    diagnostics.record({
      kind: 'batch_task_created',
      sessionId: 'session-1',
      batchId: 'batch-1',
    });
    diagnostics.record({
      kind: 'batch_session_loaded',
      sessionId: 'session-1',
      batchId: 'batch-1',
    });
    clock = 500_000;
    await diagnostics.flush();

    const lines = await readLines(filePath);
    assert.deepEqual(
      lines.map((line) => line.at),
      [1_000, 1_000],
    );
  });
});

test('an unserializable event is dropped without throwing into the caller', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    const diagnostics = createTranscriptionDiagnostics({ filePath, sensitiveRoots: [] });
    const circular: Record<string, unknown> = { kind: 'batch_received', batchId: 'batch-1' };
    circular.self = circular;

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      assert.doesNotThrow(() => {
        diagnostics.record(circular as never);
      });
      diagnostics.record({ kind: 'batch_received', batchId: 'batch-2', resetAttempts: false });
      await diagnostics.flush();
    } finally {
      console.error = originalConsoleError;
    }

    const lines = await readLines(filePath);
    assert.deepEqual(
      lines.map((line) => line.batchId),
      ['batch-2'],
    );
  });
});

test('a long provider failure body is truncated with its dropped length kept', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    const diagnostics = createTranscriptionDiagnostics({ filePath, sensitiveRoots: [] });

    diagnostics.record({
      kind: 'batch_attempt_failed',
      sessionId: 'session-1',
      batchId: 'batch-1',
      attempt: 1,
      transient: true,
      message: `OpenAI-sub transcription failed: HTTP 403 "${'<html>'.repeat(400)}"`,
    });
    await diagnostics.flush();

    const [line] = await readLines(filePath);
    const message = String(line.message);
    assert.match(message, /^OpenAI-sub transcription failed: HTTP 403/);
    assert.match(message, /… \(\+\d+ chars\)$/);
    assert.ok(message.length < 600, `message was ${message.length} characters`);
  });
});

test('a short message is left exactly as it is', async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, 'transcription.jsonl');
    const diagnostics = createTranscriptionDiagnostics({ filePath, sensitiveRoots: [] });

    diagnostics.record({
      kind: 'batch_failed',
      sessionId: 'session-1',
      batchId: 'batch-1',
      attempts: 3,
      message: 'Batch audio was not generated.',
    });
    await diagnostics.flush();

    const [line] = await readLines(filePath);
    assert.equal(line.message, 'Batch audio was not generated.');
  });
});
