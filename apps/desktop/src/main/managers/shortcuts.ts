import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import electron from 'electron';

import {
  formatShortcutChord,
  resolveDefaultDictationPromptShortcutChord,
  resolveDefaultScreenshotContextShortcutChord,
  shortcutChordToElectronAccelerator,
  shortcutChordToGnomeBinding,
  type ShortcutBackend,
  type ShortcutChord,
} from '@toph/desktop-contracts';

import type { DesktopStateStore, ShortcutStateSupport } from '../state';

const execFileAsync = promisify(execFile);
const { app, globalShortcut } = electron;
const GNOME_MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const GNOME_CUSTOM_KEYBINDING_SCHEMA =
  'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const GNOME_TOPH_DICTATION_PATH =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph/';
const GNOME_TOPH_RULE_SWITCHER_PATH =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph-rule-switcher/';

export interface ShortcutManagerConfig {
  launcherScriptPath: string;
  toggleCaptureFlag: string;
  ruleSwitcherFlag: string;
}

export interface ShortcutManager {
  installDictationShortcut: (chord: ShortcutChord) => Promise<void>;
  installRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<void>;
  registerSavedShortcuts: (chords: {
    dictation: ShortcutChord;
    ruleSwitcher: ShortcutChord;
  }) => Promise<void>;
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
  unregister: () => void;
}

interface GlobalShortcutApi {
  register: (accelerator: string, callback: () => void) => boolean;
  unregisterAll: () => void;
}

interface ShortcutSupport extends ShortcutStateSupport {
  backend: ShortcutBackend;
}

const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
const currentDesktop = (
  process.env.XDG_CURRENT_DESKTOP ??
  process.env.DESKTOP_SESSION ??
  ''
).toLowerCase();

let globalShortcutsPortalPromise: Promise<boolean> | null = null;

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function quoteVariantString(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function serializeStringArray(values: string[]) {
  return `[${values.map((value) => quoteVariantString(value)).join(', ')}]`;
}

function parseQuotedStrings(value: string) {
  return Array.from(value.matchAll(/'((?:\\'|[^'])*)'/g), (match) =>
    match[1].replaceAll("\\'", "'").replaceAll('\\\\', '\\'),
  );
}

function describeShortcutRegistrationFailure(label: string) {
  if (process.platform === 'darwin') {
    return `${label} could not be registered. macOS may reserve this shortcut for input source switching. Check System Settings > Keyboard > Keyboard Shortcuts > Input Sources, then try again.`;
  }

  return `${label} could not be registered. Another app or the operating system may already be using it.`;
}

async function gsettingsGet(schema: string, key: string, path?: string) {
  const args = path ? ['get', `${schema}:${path}`, key] : ['get', schema, key];
  const { stdout } = await execFileAsync('gsettings', args);
  return stdout.trim();
}

async function gsettingsSet(schema: string, key: string, value: string, path?: string) {
  const args = path ? ['set', `${schema}:${path}`, key, value] : ['set', schema, key, value];
  await execFileAsync('gsettings', args);
}

async function supportsGlobalShortcutsPortal() {
  if (globalShortcutsPortalPromise) {
    return globalShortcutsPortalPromise;
  }

  globalShortcutsPortalPromise = (async () => {
    try {
      const { stdout } = await execFileAsync('gdbus', [
        'introspect',
        '--session',
        '--dest',
        'org.freedesktop.portal.Desktop',
        '--object-path',
        '/org/freedesktop/portal/desktop',
      ]);

      return stdout.includes('org.freedesktop.portal.GlobalShortcuts');
    } catch {
      return false;
    }
  })();

  return globalShortcutsPortalPromise;
}

async function shouldUseGnomeShortcutFallback() {
  const portalSupported = await supportsGlobalShortcutsPortal();
  const isWayland = sessionType === 'wayland';
  const isGnome = currentDesktop.includes('gnome');
  return isWayland && isGnome && !portalSupported;
}

function getShortcutLauncherCommand(config: ShortcutManagerConfig, flag: string) {
  if (app.isPackaged) {
    return `${shellQuote(process.execPath)} ${flag}`;
  }

  return `sh ${shellQuote(config.launcherScriptPath)} ${flag}`;
}

async function installGnomeShortcut(options: {
  path: string;
  name: string;
  command: string;
  binding: string;
}) {
  const keybindings = parseQuotedStrings(
    await gsettingsGet(GNOME_MEDIA_KEYS_SCHEMA, 'custom-keybindings'),
  );
  const updatedKeybindings = keybindings.includes(options.path)
    ? keybindings
    : [...keybindings, options.path];

  await gsettingsSet(
    GNOME_MEDIA_KEYS_SCHEMA,
    'custom-keybindings',
    serializeStringArray(updatedKeybindings),
  );
  await gsettingsSet(
    GNOME_CUSTOM_KEYBINDING_SCHEMA,
    'name',
    quoteVariantString(options.name),
    options.path,
  );
  await gsettingsSet(
    GNOME_CUSTOM_KEYBINDING_SCHEMA,
    'command',
    quoteVariantString(options.command),
    options.path,
  );
  await gsettingsSet(
    GNOME_CUSTOM_KEYBINDING_SCHEMA,
    'binding',
    quoteVariantString(options.binding),
    options.path,
  );
}

async function suspendGnomeShortcut(path: string) {
  await gsettingsSet(GNOME_CUSTOM_KEYBINDING_SCHEMA, 'binding', quoteVariantString(''), path);
}

function createSupport(
  chord: ShortcutChord,
  registered: boolean,
  backend: ShortcutBackend,
): ShortcutSupport {
  const label = formatShortcutChord(chord, process.platform);
  return {
    backend,
    registered,
    installable: true,
    installed: registered,
    detail: registered
      ? backend === 'gnome-custom-shortcut'
        ? `GNOME custom shortcut fallback is installed. ${label} should trigger Toph even when another app is focused.`
        : 'Electron global shortcut registration is active.'
      : describeShortcutRegistrationFailure(label),
  };
}

export function createShortcutManager(options: {
  stateStore: DesktopStateStore;
  config: ShortcutManagerConfig;
  onDictationTrigger: () => void;
  onRuleSwitcherTrigger: () => void;
  onScreenshotContextTrigger: () => void;
  onDictationPromptTrigger: () => void;
  isScreenshotContextEnabled?: () => boolean;
  isDictationPromptEnabled?: () => boolean;
  persistDictationShortcut: (chord: ShortcutChord) => Promise<void>;
  persistRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<void>;
  shortcutApi?: GlobalShortcutApi;
}): ShortcutManager {
  const shortcutApi = options.shortcutApi ?? globalShortcut;
  let shortcutQueue: Promise<void> = Promise.resolve();
  let suspended = false;
  let savedChords = {
    dictation: options.stateStore.getState().shortcut.chord,
    ruleSwitcher: options.stateStore.getState().ruleSwitcherShortcut.chord,
  };

  const enqueue = (operation: () => Promise<void>) => {
    const task = shortcutQueue.then(operation);
    shortcutQueue = task.catch(() => {});
    return task;
  };

  const registerElectronShortcuts = (chords: typeof savedChords) => {
    shortcutApi.unregisterAll();
    const dictationRegistered = shortcutApi.register(
      shortcutChordToElectronAccelerator(chords.dictation, process.platform),
      options.onDictationTrigger,
    );
    const ruleSwitcherRegistered = shortcutApi.register(
      shortcutChordToElectronAccelerator(chords.ruleSwitcher, process.platform),
      options.onRuleSwitcherTrigger,
    );

    if (dictationRegistered && ruleSwitcherRegistered) {
      if (options.isScreenshotContextEnabled?.() === true) {
        const screenshotChord = resolveDefaultScreenshotContextShortcutChord(process.platform);
        const screenshotRegistered = shortcutApi.register(
          shortcutChordToElectronAccelerator(screenshotChord, process.platform),
          options.onScreenshotContextTrigger,
        );
        if (!screenshotRegistered) {
          console.warn(
            `Toph could not register manual screenshot context shortcut ${formatShortcutChord(screenshotChord, process.platform)}.`,
          );
        }
      }

      if (options.isDictationPromptEnabled?.() === true) {
        const dictationPromptChord = resolveDefaultDictationPromptShortcutChord(process.platform);
        const dictationPromptRegistered = shortcutApi.register(
          shortcutChordToElectronAccelerator(dictationPromptChord, process.platform),
          options.onDictationPromptTrigger,
        );
        if (!dictationPromptRegistered) {
          console.warn(
            `Toph could not register Dictation Prompt shortcut ${formatShortcutChord(dictationPromptChord, process.platform)}.`,
          );
        }
      }
    }

    return {
      dictation: createSupport(chords.dictation, dictationRegistered, 'electron-global-shortcut'),
      ruleSwitcher: createSupport(
        chords.ruleSwitcher,
        ruleSwitcherRegistered,
        'electron-global-shortcut',
      ),
    };
  };

  const registerGnomeShortcuts = async (chords: typeof savedChords) => {
    shortcutApi.unregisterAll();
    try {
      await Promise.all([
        installGnomeShortcut({
          path: GNOME_TOPH_DICTATION_PATH,
          name: 'Toph Toggle Dictation',
          command: getShortcutLauncherCommand(options.config, options.config.toggleCaptureFlag),
          binding: shortcutChordToGnomeBinding(chords.dictation),
        }),
        installGnomeShortcut({
          path: GNOME_TOPH_RULE_SWITCHER_PATH,
          name: 'Toph Rule Switcher',
          command: getShortcutLauncherCommand(options.config, options.config.ruleSwitcherFlag),
          binding: shortcutChordToGnomeBinding(chords.ruleSwitcher),
        }),
      ]);
      return {
        dictation: createSupport(chords.dictation, true, 'gnome-custom-shortcut'),
        ruleSwitcher: createSupport(chords.ruleSwitcher, true, 'gnome-custom-shortcut'),
      };
    } catch (error) {
      const detail = `GNOME custom shortcut fallback could not be installed. ${describeError(error)}.`;
      return {
        dictation: { ...createSupport(chords.dictation, false, 'gnome-custom-shortcut'), detail },
        ruleSwitcher: {
          ...createSupport(chords.ruleSwitcher, false, 'gnome-custom-shortcut'),
          detail,
        },
      };
    }
  };

  const registerShortcuts = async (chords: typeof savedChords) => {
    return process.platform === 'linux' && (await shouldUseGnomeShortcutFallback())
      ? registerGnomeShortcuts(chords)
      : registerElectronShortcuts(chords);
  };

  const applyState = (
    chords: typeof savedChords,
    support: Awaited<ReturnType<typeof registerShortcuts>>,
  ) => {
    options.stateStore.setShortcut('dictation', chords.dictation, support.dictation);
    options.stateStore.setShortcut('ruleSwitcher', chords.ruleSwitcher, support.ruleSwitcher);
  };

  const registerSavedNow = async (chords: typeof savedChords) => {
    suspended = false;
    const support = await registerShortcuts(chords);
    applyState(chords, support);
    savedChords = chords;
  };

  const installNow = async (kind: 'dictation' | 'ruleSwitcher', chord: ShortcutChord) => {
    const previous = savedChords;
    const next = { ...savedChords, [kind]: chord };
    suspended = false;

    const support = await registerShortcuts(next);
    if (!support.dictation.registered || !support.ruleSwitcher.registered) {
      await registerSavedNow(previous);
      const failed = kind === 'dictation' ? support.dictation : support.ruleSwitcher;
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
        shortcutApi.unregisterAll();
        if (options.stateStore.getState().shortcut.backend === 'gnome-custom-shortcut') {
          await Promise.all([
            suspendGnomeShortcut(GNOME_TOPH_DICTATION_PATH),
            suspendGnomeShortcut(GNOME_TOPH_RULE_SWITCHER_PATH),
          ]);
        }
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
      shortcutApi.unregisterAll();
    },
  };
}
