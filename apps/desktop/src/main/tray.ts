import { readFileSync } from 'node:fs';

import { Menu, Tray, nativeImage, nativeTheme } from 'electron';

import type { AppState } from '@toph/desktop-contracts';

import trayIconDark from '../../../../assets/tray-icon-dark.png?asset';
import trayIconDark2x from '../../../../assets/tray-icon-dark@2x.png?asset';
import trayIconLight from '../../../../assets/tray-icon-light.png?asset';
import trayIconLight2x from '../../../../assets/tray-icon-light@2x.png?asset';
import trayIconTemplate from '../../../../assets/tray-iconTemplate.png?asset';
import trayIconTemplate2x from '../../../../assets/tray-iconTemplate@2x.png?asset';

function isTophReady(state: AppState) {
  return state.providers.ready && state.permissions.ready && state.shortcut.registered;
}

function usesAttachedContextMenu() {
  return process.platform === 'linux';
}

function configureTrayPlatformBehavior(options: {
  tray: Tray;
  getContextMenu: () => Menu | null;
  openToph: () => void;
}) {
  const showContextMenu = () => {
    const contextMenu = options.getContextMenu();
    if (contextMenu) {
      options.tray.popUpContextMenu(contextMenu);
    }
  };

  if (process.platform === 'darwin') {
    options.tray.on('click', showContextMenu);
    options.tray.on('right-click', showContextMenu);
    return;
  }

  if (usesAttachedContextMenu()) {
    options.tray.on('click', options.openToph);
    return;
  }

  options.tray.on('click', options.openToph);
  options.tray.on('right-click', showContextMenu);
}

function getTrayIconPaths(): { icon1x: string; icon2x: string } {
  if (process.platform === 'darwin') {
    return { icon1x: trayIconTemplate, icon2x: trayIconTemplate2x };
  }

  // Windows and Linux: manual check
  if (nativeTheme.shouldUseDarkColors) {
    return { icon1x: trayIconDark, icon2x: trayIconDark2x };
  } else {
    return { icon1x: trayIconLight, icon2x: trayIconLight2x };
  }
}

function createTrayIcon() {
  const { icon1x, icon2x } = getTrayIconPaths();
  const image = nativeImage.createFromPath(icon1x);

  if (image.isEmpty()) {
    throw new Error(`Failed to load tray icon asset: ${icon1x}`);
  }

  // Vite emits hashed asset names, so do not rely on Electron discovering
  // @2x siblings by filename. Add the high-DPI representation explicitly.
  image.addRepresentation({
    scaleFactor: 2,
    buffer: readFileSync(icon2x),
  });

  // Vite also mangles the Template suffix, so force template rendering.
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  return image;
}

export interface DesktopTrayController {
  create: () => void;
  refresh: () => void;
  dispose: () => void;
}

export function createDesktopTrayController(options: {
  appName: string;
  getState: () => AppState;
  showSettings: () => void;
  quit: () => void;
}): DesktopTrayController {
  let tray: Tray | null = null;
  let contextMenu: Menu | null = null;
  let nativeThemeUpdated: (() => void) | null = null;

  const refresh = () => {
    if (!tray) {
      return;
    }

    const state = options.getState();
    contextMenu = Menu.buildFromTemplate([
      {
        label: `Status: ${isTophReady(state) ? 'Ready' : 'Needs setup'}`,
        enabled: false,
      },
      {
        label: 'Open Toph',
        click: options.showSettings,
      },
      {
        type: 'separator',
      },
      {
        label: 'Quit Toph',
        click: options.quit,
      },
    ]);
    if (usesAttachedContextMenu()) {
      tray.setContextMenu(contextMenu);
    }
  };

  return {
    create() {
      if (tray) {
        return;
      }

      tray = new Tray(createTrayIcon());
      tray.setToolTip(options.appName);
      configureTrayPlatformBehavior({
        tray,
        getContextMenu: () => contextMenu,
        openToph: options.showSettings,
      });

      if (process.platform !== 'darwin') {
        nativeThemeUpdated = () => {
          if (tray) {
            tray.setImage(createTrayIcon());
          }
        };
        nativeTheme.on('updated', nativeThemeUpdated);
      }

      refresh();
    },
    refresh,
    dispose() {
      if (nativeThemeUpdated) {
        nativeTheme.off('updated', nativeThemeUpdated);
        nativeThemeUpdated = null;
      }

      contextMenu = null;
      tray?.destroy();
      tray = null;
    },
  };
}
