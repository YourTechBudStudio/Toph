import electron from 'electron';

import {
  formatShortcutChord,
  shortcutChordToElectronAccelerator,
  type ShortcutBackend,
  type ShortcutChord,
} from '@toph/desktop-contracts';

import type { ShortcutStateSupport } from '../state';

const { app, globalShortcut } = electron;

export interface ShortcutManagerConfig {
  launcherScriptPath: string;
  toggleCaptureFlag: string;
  ruleSwitcherFlag: string;
}

export interface ShortcutChords {
  dictation: ShortcutChord;
  ruleSwitcher: ShortcutChord;
}

export interface GlobalShortcutApi {
  register: (accelerator: string, callback: () => void) => boolean;
  unregisterAll: () => void;
}

export interface ShortcutEnvironment {
  platform: NodeJS.Platform;
  sessionType: string;
  currentDesktop: string;
  isPackaged?: boolean;
  appImagePath?: string;
}

export interface GnomeShortcutInstallRequest {
  path: string;
  name: string;
  command: string;
  binding: string;
}

export interface GnomeShortcutApi {
  installShortcuts: (shortcuts: GnomeShortcutInstallRequest[]) => Promise<void>;
  suspendShortcut: (path: string) => Promise<void>;
}

export interface ShortcutLogger {
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
}

export interface ShortcutSupport extends ShortcutStateSupport {
  backend: ShortcutBackend;
}

export interface ShortcutRegistrationSupport {
  dictation: ShortcutSupport;
  ruleSwitcher: ShortcutSupport;
}

export interface ShortcutPlatformBackend {
  registerShortcuts: (chords: ShortcutChords) => Promise<ShortcutRegistrationSupport>;
  suspend: () => Promise<void>;
  unregister: () => void;
}

export interface ShortcutPlatformBackendOptions {
  config: ShortcutManagerConfig;
  onDictationTrigger: () => void;
  onRuleSwitcherTrigger: () => void;
  shortcutApi?: GlobalShortcutApi;
  environment: ShortcutEnvironment;
  supportsGlobalShortcutsPortal?: () => Promise<boolean>;
  gnomeShortcutApi?: GnomeShortcutApi;
  logger: ShortcutLogger;
}

export const defaultShortcutLogger: ShortcutLogger = {
  info(message, details) {
    console.info(`[shortcuts] ${message}`, details ?? '');
  },
  warn(message, details) {
    console.warn(`[shortcuts] ${message}`, details ?? '');
  },
};

export function createProcessShortcutEnvironment(): ShortcutEnvironment {
  return {
    platform: process.platform,
    sessionType: (process.env.XDG_SESSION_TYPE ?? '').toLowerCase(),
    currentDesktop: (
      process.env.XDG_CURRENT_DESKTOP ??
      process.env.DESKTOP_SESSION ??
      ''
    ).toLowerCase(),
    isPackaged: app?.isPackaged ?? false,
    appImagePath: process.env.APPIMAGE ?? '',
  };
}

function describeShortcutRegistrationFailure(label: string) {
  return `${label} could not be registered. Another app or the operating system may already be using it.`;
}

export function createShortcutSupport(options: {
  chord: ShortcutChord;
  registered: boolean;
  backend: ShortcutBackend;
  platform: NodeJS.Platform;
  describeFailure?: (label: string) => string;
}): ShortcutSupport {
  const label = formatShortcutChord(options.chord, options.platform);
  return {
    backend: options.backend,
    registered: options.registered,
    installable: true,
    installed: options.registered,
    detail: options.registered
      ? options.backend === 'gnome-custom-shortcut'
        ? `GNOME custom shortcut fallback is installed. ${label} should trigger Toph even when another app is focused.`
        : 'Electron global shortcut registration is active.'
      : (options.describeFailure ?? describeShortcutRegistrationFailure)(label),
  };
}

export function createElectronShortcutBackend(options: {
  onDictationTrigger: () => void;
  onRuleSwitcherTrigger: () => void;
  shortcutApi?: GlobalShortcutApi;
  environment: ShortcutEnvironment;
  logger: ShortcutLogger;
  describeFailure?: (label: string) => string;
}): ShortcutPlatformBackend {
  const shortcutApi = options.shortcutApi ?? globalShortcut;

  return {
    async registerShortcuts(chords) {
      shortcutApi.unregisterAll();
      const dictationAccelerator = shortcutChordToElectronAccelerator(
        chords.dictation,
        options.environment.platform,
      );
      const ruleSwitcherAccelerator = shortcutChordToElectronAccelerator(
        chords.ruleSwitcher,
        options.environment.platform,
      );
      const dictationRegistered = shortcutApi.register(
        dictationAccelerator,
        options.onDictationTrigger,
      );
      const ruleSwitcherRegistered = shortcutApi.register(
        ruleSwitcherAccelerator,
        options.onRuleSwitcherTrigger,
      );
      options.logger.info('Registered Electron global shortcuts.', {
        dictationAccelerator,
        dictationRegistered,
        ruleSwitcherAccelerator,
        ruleSwitcherRegistered,
      });

      return {
        dictation: createShortcutSupport({
          chord: chords.dictation,
          registered: dictationRegistered,
          backend: 'electron-global-shortcut',
          platform: options.environment.platform,
          describeFailure: options.describeFailure,
        }),
        ruleSwitcher: createShortcutSupport({
          chord: chords.ruleSwitcher,
          registered: ruleSwitcherRegistered,
          backend: 'electron-global-shortcut',
          platform: options.environment.platform,
          describeFailure: options.describeFailure,
        }),
      };
    },

    async suspend() {
      shortcutApi.unregisterAll();
    },

    unregister() {
      shortcutApi.unregisterAll();
    },
  };
}
