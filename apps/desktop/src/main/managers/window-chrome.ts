import type { BrowserWindowConstructorOptions } from 'electron';

export function getSettingsWindowChromeOptions(
  platform: NodeJS.Platform,
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
    };
  }

  if (platform === 'linux' || platform === 'win32') {
    return {
      frame: false,
    };
  }

  return {};
}
