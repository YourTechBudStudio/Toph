import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { AppState, AppUpdateState } from '@toph/desktop-contracts';

import {
  createDesktopUpdateCoordinator,
  type UpdateCoordinatorUpdater,
} from '../../src/main/updater/update-coordinator.ts';
import type { DesktopStateStore } from '../../src/main/state.ts';

class FakeUpdater extends EventEmitter implements UpdateCoordinatorUpdater {
  autoDownload = true;
  allowPrerelease = true;
  autoInstallOnAppQuit = true;
  forceDevUpdateConfig = false;
  logger: typeof console | null = null;
  feedUrl: string | null = null;
  checkResult: Awaited<ReturnType<UpdateCoordinatorUpdater['checkForUpdates']>> = null;
  checkError: Error | null = null;
  downloadError: Error | null = null;
  downloadCalls = 0;
  quitAndInstallCalls: Array<[boolean | undefined, boolean | undefined]> = [];

  setFeedURL(options: { provider: 'generic'; url: string }) {
    this.feedUrl = options.url;
  }

  async checkForUpdates() {
    if (this.checkError) {
      throw this.checkError;
    }
    return this.checkResult;
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
    if (this.downloadError) {
      throw this.downloadError;
    }
    this.emit('download-progress', { percent: 42 });
    this.emit('update-downloaded', { version: '0.0.4', downloadedFile: '/tmp/Toph.AppImage' });
    return ['/tmp/Toph.AppImage'];
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.quitAndInstallCalls.push([isSilent, isForceRunAfter]);
  }
}

function createStateStore(initialUpdate: AppUpdateState = { kind: 'idle', lastCheckedAt: null }) {
  let state = {
    app: {
      version: '0.0.3',
      update: initialUpdate,
    },
  } as AppState;

  const store = {
    getState: () => state,
    setAppUpdate(update: AppUpdateState) {
      state = { ...state, app: { ...state.app, update } };
    },
    subscribe: () => () => {},
  } as DesktopStateStore;

  return { store, getState: () => state };
}

function createTimers() {
  const timeouts: Array<() => void> = [];
  const intervals: Array<() => void> = [];

  return {
    timeouts,
    intervals,
    setTimeout(handler: () => void) {
      timeouts.push(handler);
      return { kind: 'timeout' } as NodeJS.Timeout;
    },
    clearTimeout() {},
    setInterval(handler: () => void) {
      intervals.push(handler);
      return { kind: 'interval' } as NodeJS.Timeout;
    },
    clearInterval() {},
  };
}

test('manual check shows up-to-date state, then resets to idle', async () => {
  const updater = new FakeUpdater();
  updater.checkResult = {
    isUpdateAvailable: false,
    updateInfo: { version: '0.0.3', files: [], path: '', sha512: '' },
    versionInfo: { version: '0.0.3', files: [], path: '', sha512: '' },
  };
  const state = createStateStore();
  const timers = createTimers();
  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'darwin',
    env: {},
    openExternal: async () => {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  await coordinator.checkForUpdates();

  assert.equal(state.getState().app.update.kind, 'up_to_date');
  assert.equal(timers.timeouts.length, 1);

  timers.timeouts[0]();

  assert.equal(state.getState().app.update.kind, 'idle');
  coordinator.dispose();
});

test('Linux preflight failure shows fallback instructions instead of download state', async () => {
  const updater = new FakeUpdater();
  updater.checkResult = {
    isUpdateAvailable: true,
    updateInfo: { version: '0.0.4', files: [], path: '', sha512: '' },
    versionInfo: { version: '0.0.4', files: [], path: '', sha512: '' },
  };
  const state = createStateStore();
  const timers = createTimers();
  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'linux',
    env: { APPIMAGE: '/opt/Toph.AppImage' },
    canAccessPath: async () => false,
    openExternal: async () => {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  await coordinator.checkForUpdates();

  const update = state.getState().app.update;
  assert.equal(update.kind, 'linux_fallback');
  if (update.kind === 'linux_fallback') {
    assert.equal(update.version, '0.0.4');
    assert.equal(update.instructions.currentPath, '/opt/Toph.AppImage');
    assert.match(update.instructions.commands, /Toph-0\.0\.4-linux-x86_64\.AppImage/);
  }
  assert.equal(updater.downloadCalls, 0);
  coordinator.dispose();
});

test('download progress and downloaded event advance to restart state', async () => {
  const updater = new FakeUpdater();
  const state = createStateStore({ kind: 'available', version: '0.0.4', releaseDate: null });
  const timers = createTimers();
  let preparedToRestart = false;
  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'darwin',
    env: {},
    openExternal: async () => {},
    canRestartToUpdate: () => true,
    prepareToRestart: () => {
      preparedToRestart = true;
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  await coordinator.downloadUpdate();

  assert.equal(updater.downloadCalls, 1);
  assert.deepEqual(state.getState().app.update, { kind: 'ready_to_restart', version: '0.0.4' });

  await coordinator.restartToUpdate();

  assert.equal(preparedToRestart, true);
  assert.deepEqual(updater.quitAndInstallCalls, [[false, true]]);
  coordinator.dispose();
});

test('restart is blocked while the app is not ready to restart', async () => {
  const updater = new FakeUpdater();
  const state = createStateStore({ kind: 'ready_to_restart', version: '0.0.4' });
  const timers = createTimers();
  let preparedToRestart = false;
  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'darwin',
    env: {},
    openExternal: async () => {},
    canRestartToUpdate: () => false,
    prepareToRestart: () => {
      preparedToRestart = true;
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  await coordinator.restartToUpdate();

  assert.equal(preparedToRestart, false);
  assert.deepEqual(updater.quitAndInstallCalls, []);
  assert.deepEqual(state.getState().app.update, {
    kind: 'failed',
    trigger: 'manual',
    message: 'Finish dictation before restarting to update',
  });

  timers.intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.getState().app.update, {
    kind: 'failed',
    trigger: 'manual',
    message: 'Finish dictation before restarting to update',
  });

  timers.timeouts[0]();

  assert.deepEqual(state.getState().app.update, { kind: 'ready_to_restart', version: '0.0.4' });
  coordinator.dispose();
});

test('scheduled check failures are logged and return to idle without user failure state', async () => {
  const updater = new FakeUpdater();
  updater.checkError = new Error('network is having a day');
  const state = createStateStore();
  const timers = createTimers();
  const consoleError = console.error;
  console.error = () => {};

  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'darwin',
    env: {},
    openExternal: async () => {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  assert.equal(timers.intervals.length, 1);
  timers.intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.getState().app.update, { kind: 'idle', lastCheckedAt: null });

  console.error = consoleError;
  coordinator.dispose();
});

test('scheduled checks do not erase a downloaded update restart state', async () => {
  const updater = new FakeUpdater();
  updater.checkError = new Error('network is having a day');
  const state = createStateStore({ kind: 'ready_to_restart', version: '0.0.4' });
  const timers = createTimers();
  const coordinator = createDesktopUpdateCoordinator({
    stateStore: state.store,
    updater,
    platform: 'darwin',
    env: {},
    openExternal: async () => {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });

  timers.intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.getState().app.update, { kind: 'ready_to_restart', version: '0.0.4' });
  coordinator.dispose();
});
