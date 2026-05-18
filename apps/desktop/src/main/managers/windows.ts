import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, screen } from 'electron';

import {
  DEFAULT_APP_SETTINGS,
  DESKTOP_IPC_CHANNELS,
  OVERLAY_WINDOW_GEOMETRY,
  type AppState,
  type OverlaySize,
  type SoundEventKind,
} from '@toph/desktop-contracts';

export interface WindowManager {
  create: () => Promise<void>;
  showSettings: () => void;
  hideSettings: () => void;
  showOverlay: () => void;
  setHideFromScreenCapture: (enabled: boolean) => void;
  withOverlayHidden: <T>(operation: () => Promise<T>) => Promise<T>;
  resizeOverlay: (size: OverlaySize) => void;
  sendState: (state: AppState) => void;
  emitSound: (kind: SoundEventKind) => void;
  trackOverlayPlacement: () => () => void;
}

const mainBundleDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(mainBundleDir, '../preload/index.mjs');
const overlayCursorFollowIntervalMs = 250;
const overlayCaptureHideDelayMs = 80;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRendererPath(page: 'index.html' | 'overlay.html') {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}/${page}`;
  }

  return join(mainBundleDir, `../renderer/${page}`);
}

async function loadRendererPage(window: BrowserWindow, page: 'index.html' | 'overlay.html') {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(getRendererPath(page));
    return;
  }

  await window.loadFile(getRendererPath(page));
}

export function createWindowManager(options: {
  appName: string;
  appIconPath: string;
  isQuitting: () => boolean;
}): WindowManager {
  let settingsWindow: BrowserWindow | null = null;
  let overlayWindow: BrowserWindow | null = null;
  let hideFromScreenCapture = DEFAULT_APP_SETTINGS.privacy.hideFromScreenCapture;

  const applyContentProtection = () => {
    settingsWindow?.setContentProtection(hideFromScreenCapture);
    overlayWindow?.setContentProtection(hideFromScreenCapture);
  };

  const keepOverlayOnCurrentSpace = () => {
    if (!overlayWindow) {
      return;
    }

    if (process.platform !== 'darwin') {
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      return;
    }

    // macOS fullscreen apps are separate Spaces. Re-applying this while
    // preparing the overlay keeps it detached from the Space where it started.
    overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    overlayWindow.setHiddenInMissionControl(true);
  };

  const positionOverlay = () => {
    if (!overlayWindow) {
      return;
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { workArea } = display;
    const bounds = overlayWindow.getBounds();
    const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    // The renderer anchors the visible pill to the bottom of this transparent
    // window, so the active state can expand upward without moving the idle
    // affordance away from the screen edge.
    const y = Math.round(workArea.y + workArea.height - bounds.height);

    if (bounds.x === x && bounds.y === y) {
      return;
    }

    overlayWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
  };

  const resizeOverlayToContent = (size: OverlaySize) => {
    if (!overlayWindow) {
      return;
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { workArea } = display;
    const width = Math.max(1, Math.min(Math.ceil(size.width), workArea.width));
    const height = Math.max(1, Math.min(Math.ceil(size.height), workArea.height));
    overlayWindow.setBounds({
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + workArea.height - height),
      width,
      height,
    });
  };

  const ensureOverlayVisible = () => {
    if (!overlayWindow) {
      return;
    }

    positionOverlay();
    keepOverlayOnCurrentSpace();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    if (!overlayWindow.isVisible()) {
      overlayWindow.showInactive();
    }

    overlayWindow.moveTop();
  };

  const createSettingsWindow = () => {
    settingsWindow = new BrowserWindow({
      width: 1080,
      height: 760,
      minWidth: 920,
      minHeight: 680,
      title: options.appName,
      icon: options.appIconPath,
      backgroundColor: '#24273a',
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 18, y: 18 },
          }
        : {}),
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    applyContentProtection();

    settingsWindow.on('close', (event) => {
      if (options.isQuitting()) {
        return;
      }

      event.preventDefault();
      settingsWindow?.hide();
    });

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });

    return loadRendererPage(settingsWindow, 'index.html');
  };

  const createOverlayWindow = async () => {
    overlayWindow = new BrowserWindow({
      width: OVERLAY_WINDOW_GEOMETRY.width,
      height: OVERLAY_WINDOW_GEOMETRY.height,
      frame: false,
      transparent: true,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    applyContentProtection();

    keepOverlayOnCurrentSpace();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    overlayWindow.setIgnoreMouseEvents(true);
    overlayWindow.on('closed', () => {
      overlayWindow = null;
    });

    await loadRendererPage(overlayWindow, 'overlay.html');
    ensureOverlayVisible();
  };

  return {
    async create() {
      await Promise.all([createSettingsWindow(), createOverlayWindow()]);
    },

    showSettings() {
      if (!settingsWindow) {
        return;
      }

      settingsWindow.show();
      settingsWindow.focus();
    },

    hideSettings() {
      settingsWindow?.hide();
    },

    showOverlay() {
      ensureOverlayVisible();
    },

    setHideFromScreenCapture(enabled) {
      hideFromScreenCapture = enabled;
      applyContentProtection();
    },

    async withOverlayHidden(operation) {
      const currentOverlayWindow = overlayWindow;
      const shouldRestore =
        !!currentOverlayWindow &&
        !currentOverlayWindow.isDestroyed() &&
        currentOverlayWindow.isVisible();

      if (shouldRestore) {
        currentOverlayWindow.hide();
        // Let the compositor publish one frame without the overlay before
        // desktopCapturer samples the active display.
        await wait(overlayCaptureHideDelayMs);
      }

      try {
        return await operation();
      } finally {
        if (
          shouldRestore &&
          overlayWindow === currentOverlayWindow &&
          !currentOverlayWindow.isDestroyed()
        ) {
          ensureOverlayVisible();
        }
      }
    },

    resizeOverlay(size) {
      resizeOverlayToContent(size);
    },

    sendState(state) {
      const overlayInteractive = state.phase !== 'idle' || state.ruleSwitcher.mode !== 'idle';
      overlayWindow?.setIgnoreMouseEvents(!overlayInteractive);
      overlayWindow?.setFocusable(state.ruleSwitcher.mode === 'selecting');
      if (state.ruleSwitcher.mode === 'selecting') {
        ensureOverlayVisible();
        overlayWindow?.focus();
      }
      settingsWindow?.webContents.send(DESKTOP_IPC_CHANNELS.state, state);
      overlayWindow?.webContents.send(DESKTOP_IPC_CHANNELS.state, state);
    },

    emitSound(kind) {
      overlayWindow?.webContents.send(DESKTOP_IPC_CHANNELS.sound, kind);
    },

    trackOverlayPlacement() {
      screen.on('display-metrics-changed', positionOverlay);
      screen.on('display-added', positionOverlay);
      screen.on('display-removed', positionOverlay);
      const followCursorTimer = setInterval(positionOverlay, overlayCursorFollowIntervalMs);

      return () => {
        clearInterval(followCursorTimer);
        screen.off('display-metrics-changed', positionOverlay);
        screen.off('display-added', positionOverlay);
        screen.off('display-removed', positionOverlay);
      };
    },
  };
}
