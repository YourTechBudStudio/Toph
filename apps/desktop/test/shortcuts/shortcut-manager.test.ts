import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shortcutChordToElectronAccelerator,
  type AppState,
  type ShortcutChord,
} from '@toph/desktop-contracts';

import type { ShortcutPlatformBackend } from '../../src/main/managers/shortcuts.platform.ts';
import { createShortcutManager } from '../../src/main/managers/shortcuts.ts';
import type { DesktopStateStore, ShortcutStateSupport } from '../../src/main/state.ts';

const defaultChord: ShortcutChord = { modifiers: ['control', 'alt'], key: 'Space' };
const alternateChord: ShortcutChord = { modifiers: ['control', 'alt'], key: 'X' };
const thirdChord: ShortcutChord = { modifiers: ['control', 'shift'], key: 'K' };
const ruleSwitcherChord: ShortcutChord = { modifiers: ['control'], key: 'Space' };
const alternateRuleSwitcherChord: ShortcutChord = { modifiers: ['control'], key: 'R' };
const linuxX11Environment = {
  platform: 'linux' as const,
  sessionType: 'x11',
  currentDesktop: 'GNOME',
};
const unityWaylandEnvironment = {
  platform: 'linux' as const,
  sessionType: 'wayland',
  currentDesktop: 'Unity',
};
const appImageWaylandEnvironment = {
  ...unityWaylandEnvironment,
  isPackaged: true,
  appImagePath: '/bin/sh',
};
const noopLogger = {
  info() {},
  warn() {},
};

function createStateStore(chord: ShortcutChord = defaultChord) {
  const state = {
    shortcut: {
      chord,
      backend: 'electron-global-shortcut',
      registered: true,
      installable: true,
      installed: true,
      detail: 'Registered.',
    },
    ruleSwitcherShortcut: {
      chord: ruleSwitcherChord,
      backend: 'electron-global-shortcut',
      registered: true,
      installable: true,
      installed: true,
      detail: 'Registered.',
    },
  } as AppState;

  const store: Pick<DesktopStateStore, 'getState' | 'setShortcut'> = {
    getState() {
      return state;
    },
    setShortcut(
      kind: 'dictation' | 'ruleSwitcher',
      nextChord: ShortcutChord,
      support: ShortcutStateSupport,
    ) {
      if (kind === 'dictation') {
        state.shortcut = {
          ...state.shortcut,
          chord: nextChord,
          ...support,
        };
        return;
      }

      state.ruleSwitcherShortcut = {
        ...state.ruleSwitcherShortcut,
        chord: nextChord,
        ...support,
      };
    },
  };

  return store as DesktopStateStore;
}

function createGlobalShortcutApi(registerResults: boolean[] = [true]) {
  const registrations: string[] = [];
  let unregisters = 0;

  return {
    register(accelerator: string) {
      registrations.push(accelerator);
      return registerResults.shift() ?? true;
    },
    unregisterAll() {
      unregisters += 1;
    },
    getRegistrations: () => registrations,
    getUnregisters: () => unregisters,
  };
}

function createShortcutBackend(
  registerResults: Array<{ dictation?: boolean; ruleSwitcher?: boolean }> = [{}],
) {
  const registrations: Array<{ dictation: string; ruleSwitcher: string }> = [];
  let suspends = 0;
  let unregisters = 0;

  const createSupport = (registered: boolean, label: string): ShortcutStateSupport => ({
    backend: 'electron-global-shortcut',
    registered,
    installable: true,
    installed: registered,
    detail: registered ? `${label} registered.` : `${label} failed.`,
  });

  const backend: ShortcutPlatformBackend = {
    async registerShortcuts(chords) {
      registrations.push({
        dictation: shortcutChordToElectronAccelerator(chords.dictation, 'linux'),
        ruleSwitcher: shortcutChordToElectronAccelerator(chords.ruleSwitcher, 'linux'),
      });
      const result = registerResults.shift() ?? {};
      return {
        dictation: createSupport(result.dictation ?? true, 'dictation'),
        ruleSwitcher: createSupport(result.ruleSwitcher ?? true, 'rule switcher'),
      };
    },

    async suspend() {
      suspends += 1;
    },

    unregister() {
      unregisters += 1;
    },
  };

  return {
    backend,
    getRegistrations: () => registrations,
    getSuspends: () => suspends,
    getUnregisters: () => unregisters,
  };
}

test('installs and persists a custom shortcut after successful registration', async () => {
  const stateStore = createStateStore();
  const shortcutBackend = createShortcutBackend([{}]);
  const persisted: ShortcutChord[] = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async (chord) => {
      persisted.push(chord);
    },
    persistRuleSwitcherShortcut: async () => {},
    shortcutBackend: shortcutBackend.backend,
  });

  await manager.installDictationShortcut(alternateChord);

  assert.deepEqual(stateStore.getState().shortcut.chord, alternateChord);
  assert.deepEqual(persisted, [alternateChord]);
  assert.deepEqual(shortcutBackend.getRegistrations(), [
    { dictation: 'Control+Alt+X', ruleSwitcher: 'Control+Space' },
  ]);
});

test('restores the previous shortcut and skips persistence when registration fails', async () => {
  const stateStore = createStateStore();
  const shortcutBackend = createShortcutBackend([{ dictation: false }, {}]);
  const persisted: ShortcutChord[] = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async (chord) => {
      persisted.push(chord);
    },
    persistRuleSwitcherShortcut: async () => {},
    shortcutBackend: shortcutBackend.backend,
  });

  await assert.rejects(() => manager.installDictationShortcut(alternateChord));

  assert.deepEqual(stateStore.getState().shortcut.chord, defaultChord);
  assert.deepEqual(persisted, []);
  assert.deepEqual(shortcutBackend.getRegistrations(), [
    { dictation: 'Control+Alt+X', ruleSwitcher: 'Control+Space' },
    { dictation: 'Control+Alt+Space', ruleSwitcher: 'Control+Space' },
  ]);
});

test('reports the shortcut that actually failed during paired registration', async () => {
  const stateStore = createStateStore();
  const shortcutBackend = createShortcutBackend([{ ruleSwitcher: false }, {}]);
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {},
    shortcutBackend: shortcutBackend.backend,
  });

  await assert.rejects(
    () => manager.installDictationShortcut(alternateChord),
    /rule switcher failed\./,
  );
});

test('suspend unregisters the active shortcut and resume registers it again', async () => {
  const stateStore = createStateStore();
  const shortcutBackend = createShortcutBackend([{}]);
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {},
    shortcutBackend: shortcutBackend.backend,
  });

  await manager.suspend();
  await manager.resume();

  assert.equal(shortcutBackend.getSuspends(), 1);
  assert.deepEqual(shortcutBackend.getRegistrations(), [
    { dictation: 'Control+Alt+Space', ruleSwitcher: 'Control+Space' },
  ]);
});

test('queues installs so later shortcut requests win in order', async () => {
  const stateStore = createStateStore();
  const shortcutBackend = createShortcutBackend([{}, {}]);
  const persisted: ShortcutChord[] = [];
  let releaseFirstPersist: (() => void) | null = null;
  const firstPersist = new Promise<void>((resolve) => {
    releaseFirstPersist = resolve;
  });
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async (chord) => {
      persisted.push(chord);
      if (persisted.length === 1) {
        await firstPersist;
      }
    },
    persistRuleSwitcherShortcut: async () => {},
    shortcutBackend: shortcutBackend.backend,
  });

  const firstInstall = manager.installDictationShortcut(alternateChord);
  const secondInstall = manager.installDictationShortcut(thirdChord);
  releaseFirstPersist?.();
  await Promise.all([firstInstall, secondInstall]);

  assert.deepEqual(persisted, [alternateChord, thirdChord]);
  assert.deepEqual(stateStore.getState().shortcut.chord, thirdChord);
  assert.deepEqual(shortcutBackend.getRegistrations(), [
    { dictation: 'Control+Alt+X', ruleSwitcher: 'Control+Space' },
    { dictation: 'Control+Shift+K', ruleSwitcher: 'Control+Space' },
  ]);
});

test('production manager installs rule switcher shortcut while preserving dictation shortcut', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([true, true]);
  const persistedRuleSwitcher: ShortcutChord[] = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async (chord) => {
      persistedRuleSwitcher.push(chord);
    },
    shortcutApi,
    environment: linuxX11Environment,
    logger: noopLogger,
  });

  await manager.installRuleSwitcherShortcut(alternateRuleSwitcherChord);

  assert.deepEqual(stateStore.getState().shortcut.chord, defaultChord);
  assert.deepEqual(stateStore.getState().ruleSwitcherShortcut.chord, alternateRuleSwitcherChord);
  assert.deepEqual(persistedRuleSwitcher, [alternateRuleSwitcherChord]);
  assert.deepEqual(shortcutApi.getRegistrations(), ['Control+Alt+Space', 'Control+R']);
  assert.equal(shortcutApi.getUnregisters(), 1);
});

test('production manager restores both shortcuts when one registration fails', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([true, false, true, true]);
  const persistedRuleSwitcher: ShortcutChord[] = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async (chord) => {
      persistedRuleSwitcher.push(chord);
    },
    shortcutApi,
    environment: linuxX11Environment,
    logger: noopLogger,
  });

  await assert.rejects(() => manager.installRuleSwitcherShortcut(alternateRuleSwitcherChord));

  assert.deepEqual(stateStore.getState().shortcut.chord, defaultChord);
  assert.deepEqual(stateStore.getState().ruleSwitcherShortcut.chord, ruleSwitcherChord);
  assert.deepEqual(persistedRuleSwitcher, []);
  assert.deepEqual(shortcutApi.getRegistrations(), [
    'Control+Alt+Space',
    'Control+R',
    'Control+Alt+Space',
    'Control+Space',
  ]);
});

test('production manager restores both shortcuts when persistence fails', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([true, true, true, true]);
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {
      throw new Error('settings write failed');
    },
    shortcutApi,
    environment: linuxX11Environment,
    logger: noopLogger,
  });

  await assert.rejects(() => manager.installRuleSwitcherShortcut(alternateRuleSwitcherChord));

  assert.deepEqual(stateStore.getState().shortcut.chord, defaultChord);
  assert.deepEqual(stateStore.getState().ruleSwitcherShortcut.chord, ruleSwitcherChord);
  assert.deepEqual(shortcutApi.getRegistrations(), [
    'Control+Alt+Space',
    'Control+R',
    'Control+Alt+Space',
    'Control+Space',
  ]);
});

test('production manager uses GNOME fallback for Unity Wayland without shortcut portal', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([false]);
  const installedShortcuts: Array<{
    path: string;
    name: string;
    command: string;
    binding: string;
  }> = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/bin/sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {},
    shortcutApi,
    environment: unityWaylandEnvironment,
    supportsGlobalShortcutsPortal: async () => false,
    gnomeShortcutApi: {
      async installShortcuts(shortcuts) {
        installedShortcuts.push(...shortcuts);
      },
      async suspendShortcut() {},
    },
    logger: noopLogger,
  });

  await manager.registerSavedShortcuts({
    dictation: defaultChord,
    ruleSwitcher: ruleSwitcherChord,
  });

  assert.equal(stateStore.getState().shortcut.backend, 'gnome-custom-shortcut');
  assert.equal(stateStore.getState().shortcut.registered, true);
  assert.equal(stateStore.getState().ruleSwitcherShortcut.backend, 'gnome-custom-shortcut');
  assert.equal(stateStore.getState().ruleSwitcherShortcut.registered, true);
  assert.deepEqual(shortcutApi.getRegistrations(), []);
  assert.deepEqual(
    installedShortcuts.map((shortcut) => ({
      path: shortcut.path,
      command: shortcut.command,
      binding: shortcut.binding,
    })),
    [
      {
        path: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph/',
        command: "sh '/bin/sh' --toggle-capture",
        binding: '<Primary><Alt>space',
      },
      {
        path: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph-rule-switcher/',
        command: "sh '/bin/sh' --rule-switcher",
        binding: '<Primary>space',
      },
    ],
  );
});

test('production manager uses Electron backend when Unity Wayland portal is available', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([true, true]);
  let gnomeInstallAttempted = false;
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/bin/sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {},
    shortcutApi,
    environment: unityWaylandEnvironment,
    supportsGlobalShortcutsPortal: async () => true,
    gnomeShortcutApi: {
      async installShortcuts() {
        gnomeInstallAttempted = true;
      },
      async suspendShortcut() {},
    },
    logger: noopLogger,
  });

  await manager.registerSavedShortcuts({
    dictation: defaultChord,
    ruleSwitcher: ruleSwitcherChord,
  });

  assert.equal(gnomeInstallAttempted, false);
  assert.equal(stateStore.getState().shortcut.backend, 'electron-global-shortcut');
  assert.deepEqual(shortcutApi.getRegistrations(), ['Control+Alt+Space', 'Control+Space']);
});

test('production manager uses stable AppImage launcher for GNOME fallback', async () => {
  const stateStore = createStateStore();
  const shortcutApi = createGlobalShortcutApi([false]);
  const installedShortcuts: Array<{
    path: string;
    command: string;
  }> = [];
  const manager = createShortcutManager({
    stateStore,
    config: {
      launcherScriptPath: '/tmp/toph-desktop.sh',
      toggleCaptureFlag: '--toggle-capture',
      ruleSwitcherFlag: '--rule-switcher',
    },
    onDictationTrigger: () => {},
    onRuleSwitcherTrigger: () => {},
    persistDictationShortcut: async () => {},
    persistRuleSwitcherShortcut: async () => {},
    shortcutApi,
    environment: appImageWaylandEnvironment,
    supportsGlobalShortcutsPortal: async () => false,
    gnomeShortcutApi: {
      async installShortcuts(shortcuts) {
        installedShortcuts.push(...shortcuts);
      },
      async suspendShortcut() {},
    },
    logger: noopLogger,
  });

  await manager.registerSavedShortcuts({
    dictation: defaultChord,
    ruleSwitcher: ruleSwitcherChord,
  });

  assert.deepEqual(
    installedShortcuts.map((shortcut) => ({
      path: shortcut.path,
      command: shortcut.command,
    })),
    [
      {
        path: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph/',
        command: "'/bin/sh' --no-sandbox --disable-gpu --toggle-capture",
      },
      {
        path: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/toph-rule-switcher/',
        command: "'/bin/sh' --no-sandbox --disable-gpu --rule-switcher",
      },
    ],
  );
});
