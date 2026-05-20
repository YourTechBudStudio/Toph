import type { ShortcutChord } from '@toph/desktop-contracts';

import type { DesktopStateStore } from '../state';
import { createDarwinShortcutBackend } from './shortcuts.darwin.ts';
import { createLinuxShortcutBackend } from './shortcuts.linux.ts';
import {
  createElectronShortcutBackend,
  createProcessShortcutEnvironment,
  defaultShortcutLogger,
  type GlobalShortcutApi,
  type GnomeShortcutApi,
  type ShortcutChords,
  type ShortcutEnvironment,
  type ShortcutLogger,
  type ShortcutManagerConfig,
  type ShortcutPlatformBackend,
  type ShortcutPlatformBackendOptions,
} from './shortcuts.platform.ts';

export type { ShortcutManagerConfig } from './shortcuts.platform.ts';

export interface ShortcutManager {
  installDictationShortcut: (chord: ShortcutChord) => Promise<void>;
  installRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<void>;
  registerSavedShortcuts: (chords: ShortcutChords) => Promise<void>;
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
  unregister: () => void;
}

function createDefaultShortcutBackend(options: ShortcutPlatformBackendOptions) {
  const electronBackend = createElectronShortcutBackend(options);
  if (options.environment.platform === 'linux') {
    return createLinuxShortcutBackend({ ...options, electronBackend });
  }
  if (options.environment.platform === 'darwin') {
    return createDarwinShortcutBackend(options);
  }

  options.logger.info('Using Electron global shortcut backend.', {
    platform: options.environment.platform,
  });
  return electronBackend;
}

export function createShortcutManager(options: {
  stateStore: DesktopStateStore;
  config: ShortcutManagerConfig;
  onDictationTrigger: () => void;
  onRuleSwitcherTrigger: () => void;
  persistDictationShortcut: (chord: ShortcutChord) => Promise<void>;
  persistRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<void>;
  shortcutApi?: GlobalShortcutApi;
  environment?: ShortcutEnvironment;
  supportsGlobalShortcutsPortal?: () => Promise<boolean>;
  gnomeShortcutApi?: GnomeShortcutApi;
  logger?: ShortcutLogger;
  shortcutBackend?: ShortcutPlatformBackend;
}): ShortcutManager {
  const environment = options.environment ?? createProcessShortcutEnvironment();
  const logger = options.logger ?? defaultShortcutLogger;
  const shortcutBackend =
    options.shortcutBackend ??
    createDefaultShortcutBackend({
      config: options.config,
      onDictationTrigger: options.onDictationTrigger,
      onRuleSwitcherTrigger: options.onRuleSwitcherTrigger,
      shortcutApi: options.shortcutApi,
      environment,
      supportsGlobalShortcutsPortal: options.supportsGlobalShortcutsPortal,
      gnomeShortcutApi: options.gnomeShortcutApi,
      logger,
    });
  let shortcutQueue: Promise<void> = Promise.resolve();
  let suspended = false;
  let savedChords: ShortcutChords = {
    dictation: options.stateStore.getState().shortcut.chord,
    ruleSwitcher: options.stateStore.getState().ruleSwitcherShortcut.chord,
  };

  const enqueue = (operation: () => Promise<void>) => {
    const task = shortcutQueue.then(operation);
    shortcutQueue = task.catch(() => {});
    return task;
  };

  const applyState = (
    chords: ShortcutChords,
    support: Awaited<ReturnType<ShortcutPlatformBackend['registerShortcuts']>>,
  ) => {
    options.stateStore.setShortcut('dictation', chords.dictation, support.dictation);
    options.stateStore.setShortcut('ruleSwitcher', chords.ruleSwitcher, support.ruleSwitcher);
  };

  const registerSavedNow = async (chords: ShortcutChords) => {
    suspended = false;
    const support = await shortcutBackend.registerShortcuts(chords);
    applyState(chords, support);
    savedChords = chords;
  };

  const installNow = async (kind: 'dictation' | 'ruleSwitcher', chord: ShortcutChord) => {
    const previous = savedChords;
    const next = { ...savedChords, [kind]: chord };
    suspended = false;

    const support = await shortcutBackend.registerShortcuts(next);
    if (!support.dictation.registered || !support.ruleSwitcher.registered) {
      await registerSavedNow(previous);
      const requested = kind === 'dictation' ? support.dictation : support.ruleSwitcher;
      const failed = !requested.registered
        ? requested
        : !support.dictation.registered
          ? support.dictation
          : support.ruleSwitcher;
      throw new Error(failed.detail);
    }

    try {
      if (kind === 'dictation') {
        await options.persistDictationShortcut(chord);
      } else {
        await options.persistRuleSwitcherShortcut(chord);
      }
    } catch (error) {
      await registerSavedNow(previous);
      throw error;
    }
    applyState(next, support);
    savedChords = next;
  };

  return {
    installDictationShortcut(chord) {
      return enqueue(() => installNow('dictation', chord));
    },

    installRuleSwitcherShortcut(chord) {
      return enqueue(() => installNow('ruleSwitcher', chord));
    },

    registerSavedShortcuts(chords) {
      return enqueue(() => registerSavedNow(chords));
    },

    suspend() {
      return enqueue(async () => {
        suspended = true;
        await shortcutBackend.suspend();
      });
    },

    resume() {
      return enqueue(async () => {
        if (!suspended) {
          return;
        }

        await registerSavedNow(savedChords);
      });
    },

    unregister() {
      shortcutBackend.unregister();
    },
  };
}
