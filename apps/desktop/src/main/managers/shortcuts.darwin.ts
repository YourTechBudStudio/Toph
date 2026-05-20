import {
  createElectronShortcutBackend,
  type ShortcutPlatformBackendOptions,
} from './shortcuts.platform.ts';

function describeMacShortcutRegistrationFailure(label: string) {
  return `${label} could not be registered. macOS may reserve this shortcut for input source switching. Check System Settings > Keyboard > Keyboard Shortcuts > Input Sources, then try again.`;
}

export function createDarwinShortcutBackend(options: ShortcutPlatformBackendOptions) {
  return createElectronShortcutBackend({
    ...options,
    describeFailure: describeMacShortcutRegistrationFailure,
  });
}
