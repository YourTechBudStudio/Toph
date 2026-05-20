import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import electron from 'electron';

import { shortcutChordToGnomeBinding } from '@toph/desktop-contracts';

import {
  createShortcutSupport,
  type GnomeShortcutApi,
  type GnomeShortcutInstallRequest,
  type ShortcutPlatformBackend,
  type ShortcutPlatformBackendOptions,
} from './shortcuts.platform.ts';

const execFileAsync = promisify(execFile);
const { app } = electron;
const GNOME_MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const GNOME_CUSTOM_KEYBINDING_SCHEMA =
  'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const GNOME_TOPH_DICTATION_PATH =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph/';
const GNOME_TOPH_RULE_SWITCHER_PATH =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph-rule-switcher/';

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

function isGnomeSettingsDesktop(currentDesktop: string) {
  const desktop = currentDesktop.toLowerCase();
  return desktop.includes('gnome') || desktop.includes('ubuntu') || desktop.includes('unity');
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

async function shouldUseGnomeShortcutFallback(options: {
  environment: ShortcutPlatformBackendOptions['environment'];
  supportsPortal: () => Promise<boolean>;
}) {
  const portalSupported = await options.supportsPortal();
  const isWayland = options.environment.sessionType === 'wayland';
  const hasGnomeSettings = isGnomeSettingsDesktop(options.environment.currentDesktop);
  return {
    useFallback: isWayland && hasGnomeSettings && !portalSupported,
    portalSupported,
    hasGnomeSettings,
  };
}

function getShortcutLauncherCommand(
  config: ShortcutPlatformBackendOptions['config'],
  environment: ShortcutPlatformBackendOptions['environment'],
  flag: string,
) {
  const isPackaged = environment.isPackaged ?? app?.isPackaged ?? false;
  const launcherPath = isPackaged
    ? environment.appImagePath || process.execPath
    : config.launcherScriptPath;
  if (!existsSync(launcherPath)) {
    throw new Error(`Shortcut launcher does not exist: ${launcherPath}`);
  }

  if (isPackaged) {
    return `${shellQuote(launcherPath)} --no-sandbox --disable-gpu ${flag}`;
  }

  return `sh ${shellQuote(launcherPath)} ${flag}`;
}

async function installGnomeShortcuts(shortcuts: GnomeShortcutInstallRequest[]) {
  const keybindings = parseQuotedStrings(
    await gsettingsGet(GNOME_MEDIA_KEYS_SCHEMA, 'custom-keybindings'),
  );
  const updatedKeybindings = shortcuts.reduce(
    (paths, shortcut) => (paths.includes(shortcut.path) ? paths : [...paths, shortcut.path]),
    keybindings,
  );

  if (updatedKeybindings.length !== keybindings.length) {
    await gsettingsSet(
      GNOME_MEDIA_KEYS_SCHEMA,
      'custom-keybindings',
      serializeStringArray(updatedKeybindings),
    );
  }

  for (const shortcut of shortcuts) {
    await gsettingsSet(
      GNOME_CUSTOM_KEYBINDING_SCHEMA,
      'name',
      quoteVariantString(shortcut.name),
      shortcut.path,
    );
    await gsettingsSet(
      GNOME_CUSTOM_KEYBINDING_SCHEMA,
      'command',
      quoteVariantString(shortcut.command),
      shortcut.path,
    );
    await gsettingsSet(
      GNOME_CUSTOM_KEYBINDING_SCHEMA,
      'binding',
      quoteVariantString(shortcut.binding),
      shortcut.path,
    );
  }
}

async function suspendGnomeShortcut(path: string) {
  await gsettingsSet(GNOME_CUSTOM_KEYBINDING_SCHEMA, 'binding', quoteVariantString(''), path);
}

export function createLinuxShortcutBackend(
  options: ShortcutPlatformBackendOptions & { electronBackend: ShortcutPlatformBackend },
): ShortcutPlatformBackend {
  const supportsPortal = options.supportsGlobalShortcutsPortal ?? supportsGlobalShortcutsPortal;
  const gnomeShortcutApi: GnomeShortcutApi = options.gnomeShortcutApi ?? {
    installShortcuts: installGnomeShortcuts,
    suspendShortcut: suspendGnomeShortcut,
  };
  let activeBackend: 'electron-global-shortcut' | 'gnome-custom-shortcut' | null = null;

  const registerGnomeShortcuts: ShortcutPlatformBackend['registerShortcuts'] = async (chords) => {
    options.electronBackend.unregister();
    activeBackend = 'gnome-custom-shortcut';
    try {
      const shortcuts = [
        {
          path: GNOME_TOPH_DICTATION_PATH,
          name: 'Toph Toggle Dictation',
          command: getShortcutLauncherCommand(
            options.config,
            options.environment,
            options.config.toggleCaptureFlag,
          ),
          binding: shortcutChordToGnomeBinding(chords.dictation),
        },
        {
          path: GNOME_TOPH_RULE_SWITCHER_PATH,
          name: 'Toph Rule Switcher',
          command: getShortcutLauncherCommand(
            options.config,
            options.environment,
            options.config.ruleSwitcherFlag,
          ),
          binding: shortcutChordToGnomeBinding(chords.ruleSwitcher),
        },
      ];
      options.logger.info('Installing GNOME custom shortcuts.', {
        desktop: options.environment.currentDesktop,
        sessionType: options.environment.sessionType,
        shortcuts: shortcuts.map((shortcut) => ({
          path: shortcut.path,
          command: shortcut.command,
          binding: shortcut.binding,
        })),
      });
      await gnomeShortcutApi.installShortcuts(shortcuts);
      return {
        dictation: createShortcutSupport({
          chord: chords.dictation,
          registered: true,
          backend: 'gnome-custom-shortcut',
          platform: options.environment.platform,
        }),
        ruleSwitcher: createShortcutSupport({
          chord: chords.ruleSwitcher,
          registered: true,
          backend: 'gnome-custom-shortcut',
          platform: options.environment.platform,
        }),
      };
    } catch (error) {
      const detail = `GNOME custom shortcut fallback could not be installed. ${describeError(error)}.`;
      options.logger.warn('GNOME custom shortcut installation failed.', { detail });
      return {
        dictation: {
          ...createShortcutSupport({
            chord: chords.dictation,
            registered: false,
            backend: 'gnome-custom-shortcut',
            platform: options.environment.platform,
          }),
          detail,
        },
        ruleSwitcher: {
          ...createShortcutSupport({
            chord: chords.ruleSwitcher,
            registered: false,
            backend: 'gnome-custom-shortcut',
            platform: options.environment.platform,
          }),
          detail,
        },
      };
    }
  };

  return {
    async registerShortcuts(chords) {
      const fallbackDecision = await shouldUseGnomeShortcutFallback({
        environment: options.environment,
        supportsPortal,
      });
      options.logger.info('Resolved Linux shortcut backend.', {
        desktop: options.environment.currentDesktop || 'unknown',
        sessionType: options.environment.sessionType || 'unknown',
        portalSupported: fallbackDecision.portalSupported,
        hasGnomeSettings: fallbackDecision.hasGnomeSettings,
        backend: fallbackDecision.useFallback
          ? 'gnome-custom-shortcut'
          : 'electron-global-shortcut',
      });

      if (fallbackDecision.useFallback) {
        return registerGnomeShortcuts(chords);
      }

      activeBackend = 'electron-global-shortcut';
      return options.electronBackend.registerShortcuts(chords);
    },

    async suspend() {
      await options.electronBackend.suspend();
      if (activeBackend === 'gnome-custom-shortcut') {
        await Promise.all([
          gnomeShortcutApi.suspendShortcut(GNOME_TOPH_DICTATION_PATH),
          gnomeShortcutApi.suspendShortcut(GNOME_TOPH_RULE_SWITCHER_PATH),
        ]);
      }
    },

    unregister() {
      options.electronBackend.unregister();
    },
  };
}
