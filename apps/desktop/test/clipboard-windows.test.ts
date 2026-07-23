import assert from 'node:assert/strict';
import test from 'node:test';

import type { PasteAttempt } from '@toph/desktop-contracts';

import {
  createWindowsClipboardManager,
  createWindowsPasteRunner,
  type WindowsPasteRunner,
} from '../src/main/managers/clipboard.windows.ts';

function createRunner(options: { inspectError?: Error; pasteError?: Error } = {}) {
  let inspections = 0;
  let pastes = 0;
  const runner: WindowsPasteRunner = {
    async inspect() {
      inspections += 1;
      if (options.inspectError) throw options.inspectError;
    },
    async paste() {
      pastes += 1;
      if (options.pasteError) throw options.pasteError;
    },
  };

  return {
    runner,
    getInspections: () => inspections,
    getPastes: () => pastes,
  };
}

test('reports Windows SendInput when the helper probe succeeds', async () => {
  const harness = createRunner();
  const manager = createWindowsClipboardManager({
    copyText: () => null,
    runner: harness.runner,
  });

  assert.deepEqual(await manager.describePasteSupport(), {
    helper: 'windows-sendinput',
    detail: 'Clipboard-first mode is active. Auto-paste will be attempted with Windows SendInput.',
  });
  assert.equal(harness.getInspections(), 1);
});

test('reports clipboard-only support when the helper probe fails', async () => {
  const harness = createRunner({ inspectError: new Error('PowerShell is blocked') });
  const manager = createWindowsClipboardManager({
    copyText: () => null,
    runner: harness.runner,
  });

  assert.deepEqual(await manager.describePasteSupport(), {
    helper: null,
    detail:
      'Clipboard write is ready, but the Windows SendInput helper is unavailable. PowerShell is blocked.',
  });
});

test('copies text before attempting Windows paste', async () => {
  const events: string[] = [];
  const manager = createWindowsClipboardManager({
    copyText(text) {
      events.push(`copy:${text}`);
      return null;
    },
    runner: {
      async inspect() {},
      async paste() {
        events.push('paste');
      },
    },
  });

  assert.deepEqual(await manager.copyAndPasteText('hello'), {
    helper: 'windows-sendinput',
    status: 'success',
    detail: 'Transcript copied to the clipboard and paste was attempted with Windows SendInput.',
    copiedToClipboard: true,
  });
  assert.deepEqual(events, ['copy:hello', 'paste']);
});

test('does not invoke SendInput when the clipboard write fails', async () => {
  const harness = createRunner();
  const copyFailure: PasteAttempt = {
    helper: null,
    status: 'failed',
    detail: 'Clipboard failed.',
    copiedToClipboard: false,
  };
  const manager = createWindowsClipboardManager({
    copyText: () => copyFailure,
    runner: harness.runner,
  });

  assert.equal(await manager.copyAndPasteText('hello'), copyFailure);
  assert.equal(harness.getPastes(), 0);
});

test('preserves the copied state when Windows input injection fails', async () => {
  const harness = createRunner({ pasteError: new Error('input blocked') });
  const manager = createWindowsClipboardManager({
    copyText: () => null,
    runner: harness.runner,
  });

  assert.deepEqual(await manager.copyAndPasteText('hello'), {
    helper: 'windows-sendinput',
    status: 'failed',
    detail:
      'Transcript copied to the clipboard, but Windows automatic paste failed. The target may be running as Administrator. input blocked.',
    copiedToClipboard: true,
  });
});

test('compiles once and invokes the cached helper directly for paste', async () => {
  const scripts: string[] = [];
  const helperInvocations: Array<{ helperPath: string; args: string[] }> = [];
  const runner = createWindowsPasteRunner({
    helperPath: 'C:\\Temp\\toph-windows-paste.exe',
    async executePowerShell(script) {
      scripts.push(script);
    },
    async executeHelper(helperPath, args) {
      helperInvocations.push({ helperPath, args });
    },
  });

  await runner.inspect();
  await runner.inspect();
  await runner.paste();

  assert.equal(scripts.length, 1);
  assert.match(scripts[0]!, /Add-Type/);
  assert.match(scripts[0]!, /-OutputAssembly/);
  assert.deepEqual(helperInvocations, [
    { helperPath: 'C:\\Temp\\toph-windows-paste.exe', args: ['--inspect'] },
    { helperPath: 'C:\\Temp\\toph-windows-paste.exe', args: [] },
  ]);
  assert.doesNotMatch(scripts.join('\n'), /private transcript/);
});

test('paste initializes the helper when startup inspection was skipped', async () => {
  let compilations = 0;
  const helperArguments: string[][] = [];
  const runner = createWindowsPasteRunner({
    async executePowerShell() {
      compilations += 1;
    },
    async executeHelper(_helperPath, args) {
      helperArguments.push(args);
    },
  });

  await runner.paste();
  await runner.paste();

  assert.equal(compilations, 1);
  assert.deepEqual(helperArguments, [['--inspect'], [], []]);
});
