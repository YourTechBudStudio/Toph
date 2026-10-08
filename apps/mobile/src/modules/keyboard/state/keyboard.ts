import { AppState } from 'react-native';
import { create } from 'zustand';

import { TophKeyboard } from '../../../../modules/toph-keyboard';

interface KeyboardState {
  readonly enabled: boolean;
}

/**
 * Whether Toph Voice is turned on in Android's keyboard settings. Read synchronously when the
 * store is created, so nothing decides from a default, and again whenever the app comes back to
 * the foreground, because it is changed in system settings.
 */
export const useKeyboardStore = create<KeyboardState>()(() => ({
  enabled: TophKeyboard.isEnabled(),
}));

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    useKeyboardStore.setState({ enabled: TophKeyboard.isEnabled() });
  }
});

/** Opens Android's keyboard settings; coming back to the app refreshes `enabled`. */
export function openKeyboardSettings(): void {
  TophKeyboard.openSettings();
}

export function useKeyboardEnabled(): boolean {
  return useKeyboardStore((state) => state.enabled);
}
