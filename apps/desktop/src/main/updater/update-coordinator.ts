import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater';

import type {
  AppUpdateState,
  LinuxUpdateInstructions,
  UpdateCheckTrigger,
} from '@toph/desktop-contracts';

import type { DesktopStateStore } from '../state';

type UpdateCoordinatorState = { app: { update: AppUpdateState } };
type UpdateCoordinatorStateStore = {
  getState: () => UpdateCoordinatorState;
  setAppUpdate: DesktopStateStore['setAppUpdate'];
};
type UpdateCoordinatorIntervalHandle = unknown;
type UpdateCoordinatorTimeoutHandle = unknown;
type UpdateCoordinatorScheduleInterval = (
  handler: () => void,
  delayMs: number,
) => UpdateCoordinatorIntervalHandle;
type UpdateCoordinatorCancelInterval = (timer: UpdateCoordinatorIntervalHandle) => void;
type UpdateCoordinatorScheduleTimeout = (
  handler: () => void,
  delayMs: number,
) => UpdateCoordinatorTimeoutHandle;
type UpdateCoordinatorCancelTimeout = (timer: UpdateCoordinatorTimeoutHandle) => void;

const updateReadmeUrl = 'https://github.com/YourTechBudStudio/Toph#linux-installupdate';
const initialCheckDelayMs = 30_000;
const pollIntervalMs = 3 * 60 * 60 * 1000;
const upToDateVisibleMs = 2_000;

type LinuxPreflightResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      currentPath: string | null;
    };

export interface UpdateCoordinatorUpdater {
  autoDownload: boolean;
  allowPrerelease: boolean;
  autoInstallOnAppQuit: boolean;
  forceDevUpdateConfig: boolean;
  logger: unknown;
  setFeedURL: (options: { provider: 'generic'; url: string }) => void;
  checkForUpdates: () => Promise<UpdateCheckResult | null>;
  downloadUpdate: () => Promise<Array<string>>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (
    event: 'download-progress' | 'update-downloaded' | 'error',
    listener: (...args: any[]) => void,
  ) => void;
  removeListener: (
    event: 'download-progress' | 'update-downloaded' | 'error',
    listener: (...args: any[]) => void,
  ) => void;
}

function getLastCheckedAt(update: AppUpdateState): number | null {
  if (update.kind === 'idle' || update.kind === 'checking') {
    return update.lastCheckedAt;
  }
  if (update.kind === 'up_to_date') {
    return update.checkedAt;
  }
  return null;
}

function githubLinuxAppImageUrl(version: string): string {
  return `https://github.com/YourTechBudStudio/Toph/releases/download/v${version}/Toph-${version}-linux-x86_64.AppImage`;
}

function buildLinuxUpdateCommands(version: string | null, downloadUrl: string | null): string {
  const resolvedVersion = version ?? '<latest-version>';
  const resolvedDownloadUrl =
    downloadUrl ??
    `https://github.com/YourTechBudStudio/Toph/releases/latest/download/Toph-${resolvedVersion}-linux-x86_64.AppImage`;

  return [
    'mkdir -p ~/.local/share/toph ~/.local/bin ~/.local/share/applications',
    `wget -O ~/.local/share/toph/Toph.AppImage "${resolvedDownloadUrl}"`,
    'chmod +x ~/.local/share/toph/Toph.AppImage',
    'ln -sfn ~/.local/share/toph/Toph.AppImage ~/.local/bin/toph',
    "cat > ~/.local/share/applications/toph.desktop <<'EOF'",
    '[Desktop Entry]',
    'Name=Toph',
    'Exec=sh -lc "$HOME/.local/bin/toph"',
    'Type=Application',
    'Terminal=false',
    'Categories=Utility;',
    'EOF',
    'update-desktop-database ~/.local/share/applications 2>/dev/null || true',
  ].join('\n');
}

function buildLinuxInstructions(options: {
  version: string | null;
  reason: string;
  currentPath: string | null;
}): LinuxUpdateInstructions {
  const downloadUrl = options.version ? githubLinuxAppImageUrl(options.version) : null;

  return {
    reason: options.reason,
    currentPath: options.currentPath,
    downloadUrl,
    readmeUrl: updateReadmeUrl,
    commands: buildLinuxUpdateCommands(options.version, downloadUrl),
  };
}

async function canAccessPath(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function checkLinuxPreflight(options: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  canAccessPath: (path: string, mode: number) => Promise<boolean>;
}): Promise<LinuxPreflightResult> {
  if (options.platform !== 'linux') {
    return { ok: true };
  }

  if (options.env.SNAP) {
    return {
      ok: false,
      reason: 'Toph is running inside Snap, where AppImage replacement is not available.',
      currentPath: null,
    };
  }

  const appImagePath = options.env.APPIMAGE ?? null;
  if (!appImagePath) {
    return {
      ok: false,
      reason: 'Toph is not running from an AppImage path that the updater can replace.',
      currentPath: null,
    };
  }

  const canWriteAppImage = await options.canAccessPath(
    appImagePath,
    constants.R_OK | constants.W_OK,
  );
  if (!canWriteAppImage) {
    return {
      ok: false,
      reason: 'The current AppImage is not writable by this user.',
      currentPath: appImagePath,
    };
  }

  const canWriteParent = await options.canAccessPath(dirname(appImagePath), constants.W_OK);
  if (!canWriteParent) {
    return {
      ok: false,
      reason: 'The current AppImage folder is not writable by this user.',
      currentPath: appImagePath,
    };
  }

  return { ok: true };
}

function configureAutoUpdater(options: {
  updater: UpdateCoordinatorUpdater;
  env: NodeJS.ProcessEnv;
}) {
  options.updater.autoDownload = false;
  options.updater.allowPrerelease = false;
  options.updater.autoInstallOnAppQuit = false;
  options.updater.logger = console;

  const feedUrl = options.env.TOPH_UPDATE_FEED_URL;
  if (feedUrl) {
    options.updater.forceDevUpdateConfig = true;
    options.updater.setFeedURL({ provider: 'generic', url: feedUrl });
  }
}

export function createDesktopUpdateCoordinator(options: {
  stateStore: UpdateCoordinatorStateStore;
  updater: UpdateCoordinatorUpdater;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  openExternal: (url: string) => Promise<void>;
  prepareToRestart?: () => void;
  canRestartToUpdate?: () => boolean;
  canAccessPath?: (path: string, mode: number) => Promise<boolean>;
  setInterval?: UpdateCoordinatorScheduleInterval;
  clearInterval?: UpdateCoordinatorCancelInterval;
  setTimeout?: UpdateCoordinatorScheduleTimeout;
  clearTimeout?: UpdateCoordinatorCancelTimeout;
}) {
  const updater = options.updater;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const openExternal = options.openExternal;
  const prepareToRestart = options.prepareToRestart ?? (() => {});
  const canRestartToUpdate = options.canRestartToUpdate ?? (() => true);
  const checkPathAccess = options.canAccessPath ?? canAccessPath;
  const scheduleInterval: UpdateCoordinatorScheduleInterval =
    options.setInterval ?? ((handler, delayMs) => setInterval(handler, delayMs));
  const cancelInterval: UpdateCoordinatorCancelInterval =
    options.clearInterval ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  const scheduleTimeout: UpdateCoordinatorScheduleTimeout =
    options.setTimeout ?? ((handler, delayMs) => setTimeout(handler, delayMs));
  const cancelTimeout: UpdateCoordinatorCancelTimeout =
    options.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  configureAutoUpdater({ updater, env });

  let disposed = false;
  let initialCheckTimer: UpdateCoordinatorTimeoutHandle | null = null;
  let pollTimer: UpdateCoordinatorIntervalHandle | null = null;
  let resetTimer: UpdateCoordinatorTimeoutHandle | null = null;
  let latestAvailableInfo: UpdateInfo | null = null;
  let restartBlockedVersion: string | null = null;

  const clearResetTimer = () => {
    if (resetTimer) {
      cancelTimeout(resetTimer);
      resetTimer = null;
    }
  };

  const setUpdate = (update: AppUpdateState) => {
    if (!disposed) {
      options.stateStore.setAppUpdate(update);
    }
  };

  const resetTransientStateSoon = () => {
    clearResetTimer();
    resetTimer = scheduleTimeout(() => {
      restartBlockedVersion = null;
      const current = options.stateStore.getState().app.update;
      if (current.kind === 'up_to_date' || current.kind === 'failed') {
        setUpdate({ kind: 'idle', lastCheckedAt: getLastCheckedAt(current) });
      }
    }, upToDateVisibleMs);
  };

  const showNoUpdate = (trigger: UpdateCheckTrigger) => {
    const checkedAt = Date.now();
    if (trigger === 'manual') {
      console.info('Toph update check completed. No update available.');
      setUpdate({ kind: 'up_to_date', checkedAt });
      resetTransientStateSoon();
      return;
    }
    console.info('Toph scheduled update check completed. No update available.');
    setUpdate({ kind: 'idle', lastCheckedAt: checkedAt });
  };

  const showManualFailure = (message: string) => {
    restartBlockedVersion = null;
    console.warn(`Toph update action failed. ${message}`);
    setUpdate({ kind: 'failed', trigger: 'manual', message });
    resetTransientStateSoon();
  };

  const showRestartBlocked = (version: string) => {
    const message = 'Finish dictation before restarting to update';
    console.warn(`Toph update restart blocked. version=${version} reason=${message}`);
    restartBlockedVersion = version;
    setUpdate({ kind: 'failed', trigger: 'manual', message });
    clearResetTimer();
    resetTimer = scheduleTimeout(() => {
      restartBlockedVersion = null;
      setUpdate({ kind: 'ready_to_restart', version });
    }, upToDateVisibleMs);
  };

  const downloadAvailableUpdate = async (downloadOptions: {
    version: string;
    releaseDate: string | null;
    trigger: UpdateCheckTrigger;
  }) => {
    setUpdate({ kind: 'downloading', version: downloadOptions.version, percent: 0 });
    console.info(
      `Toph update download started. version=${downloadOptions.version} trigger=${downloadOptions.trigger}`,
    );
    try {
      await updater.downloadUpdate();
    } catch (error) {
      console.error('Toph could not download the update.', error);
      if (downloadOptions.trigger === 'manual') {
        showManualFailure('Update download failed');
        return;
      }

      setUpdate({
        kind: 'available',
        version: downloadOptions.version,
        releaseDate: downloadOptions.releaseDate,
      });
    }
  };

  const showAvailableUpdate = async (
    updateInfo: UpdateInfo,
    trigger: UpdateCheckTrigger,
  ) => {
    latestAvailableInfo = updateInfo;
    console.info(`Toph update available. version=${updateInfo.version}`);

    const linuxPreflight = await checkLinuxPreflight({
      platform,
      env,
      canAccessPath: checkPathAccess,
    });
    if (!linuxPreflight.ok) {
      console.warn(
        `Toph Linux updater preflight failed. reason=${linuxPreflight.reason} currentPath=${linuxPreflight.currentPath ?? 'unknown'}`,
      );
      setUpdate({
        kind: 'linux_fallback',
        version: updateInfo.version,
        reason: linuxPreflight.reason,
        instructions: buildLinuxInstructions({
          version: updateInfo.version,
          reason: linuxPreflight.reason,
          currentPath: linuxPreflight.currentPath,
        }),
      });
      return;
    }

    setUpdate({
      kind: 'available',
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate ?? null,
    });

    await downloadAvailableUpdate({
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate ?? null,
      trigger,
    });
  };

  const handleProgress = (progress: ProgressInfo) => {
    const current = options.stateStore.getState().app.update;
    const version =
      current.kind === 'downloading' || current.kind === 'available'
        ? current.version
        : latestAvailableInfo?.version;
    if (!version) {
      return;
    }

    setUpdate({
      kind: 'downloading',
      version,
      percent: Math.max(0, Math.min(100, progress.percent)),
    });
  };

  const handleDownloaded = (event: UpdateDownloadedEvent) => {
    console.info(`Toph update downloaded. version=${event.version}`);
    setUpdate({ kind: 'ready_to_restart', version: event.version });
  };

  const handleUpdaterError = (error: Error) => {
    console.error('Toph updater emitted an error.', error);
  };

  updater.on('download-progress', handleProgress);
  updater.on('update-downloaded', handleDownloaded);
  updater.on('error', handleUpdaterError);

  const checkForUpdates = async (trigger: UpdateCheckTrigger) => {
    if (disposed) {
      return;
    }

    const previous = options.stateStore.getState().app.update;
    if (
      previous.kind === 'checking' ||
      previous.kind === 'downloading' ||
      previous.kind === 'ready_to_restart' ||
      (previous.kind === 'failed' && restartBlockedVersion !== null) ||
      (trigger === 'scheduled' &&
        (previous.kind === 'available' || previous.kind === 'linux_fallback'))
    ) {
      return;
    }

    clearResetTimer();
    console.info(`Toph update check started. trigger=${trigger}`);
    setUpdate({ kind: 'checking', trigger, lastCheckedAt: getLastCheckedAt(previous) });

    let result: UpdateCheckResult | null;
    try {
      result = await updater.checkForUpdates();
    } catch (error) {
      console.error('Toph could not check for updates.', error);
      if (trigger === 'manual') {
        showManualFailure('Update check failed');
      } else {
        setUpdate({ kind: 'idle', lastCheckedAt: getLastCheckedAt(previous) });
      }
      return;
    }

    if (!result) {
      const message = 'Updates are not available in this build.';
      if (trigger === 'manual') {
        showManualFailure(message);
      } else {
        console.info(`Toph skipped scheduled update check. ${message}`);
        setUpdate({ kind: 'idle', lastCheckedAt: getLastCheckedAt(previous) });
      }
      return;
    }

    if (!result.isUpdateAvailable) {
      showNoUpdate(trigger);
      return;
    }

    await showAvailableUpdate(result.updateInfo, trigger);
  };

  const startInitialCheck = () => {
    if (initialCheckTimer) {
      return;
    }

    initialCheckTimer = scheduleTimeout(() => {
      initialCheckTimer = null;
      void checkForUpdates('scheduled');
    }, initialCheckDelayMs);
  };

  const startPolling = () => {
    if (pollTimer) {
      return;
    }

    pollTimer = scheduleInterval(() => {
      void checkForUpdates('scheduled');
    }, pollIntervalMs);
  };

  const stopPolling = () => {
    if (pollTimer) {
      cancelInterval(pollTimer);
      pollTimer = null;
    }
  };

  startInitialCheck();
  startPolling();

  return {
    checkForUpdates: () => checkForUpdates('manual'),

    async downloadUpdate() {
      clearResetTimer();
      const current = options.stateStore.getState().app.update;
      if (current.kind !== 'available') {
        return;
      }

      await downloadAvailableUpdate({
        version: current.version,
        releaseDate: current.releaseDate,
        trigger: 'manual',
      });
    },

    async restartToUpdate() {
      const current = options.stateStore.getState().app.update;
      if (current.kind !== 'ready_to_restart') {
        return;
      }

      if (!canRestartToUpdate()) {
        showRestartBlocked(current.version);
        return;
      }

      console.info(`Toph restarting to install update. version=${current.version}`);
      prepareToRestart();
      updater.quitAndInstall(false, true);
    },

    dismissUpdateNotice() {
      clearResetTimer();
      restartBlockedVersion = null;
      const current = options.stateStore.getState().app.update;
      if (
        current.kind === 'up_to_date' ||
        current.kind === 'failed' ||
        current.kind === 'linux_fallback'
      ) {
        setUpdate({ kind: 'idle', lastCheckedAt: getLastCheckedAt(current) });
      }
    },

    async openUpdateReadme() {
      await openExternal(updateReadmeUrl);
    },

    dispose() {
      disposed = true;
      if (initialCheckTimer) {
        cancelTimeout(initialCheckTimer);
        initialCheckTimer = null;
      }
      clearResetTimer();
      stopPolling();
      updater.removeListener('download-progress', handleProgress);
      updater.removeListener('update-downloaded', handleDownloaded);
      updater.removeListener('error', handleUpdaterError);
    },
  };
}
