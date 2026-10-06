import { create } from 'zustand';

/** How long the mock trip to Android's keyboard settings takes. */
const SETTINGS_TRIP_MS = 700;

interface KeyboardState {
  readonly enabled: boolean;
  readonly enabling: boolean;
  enable(): void;
}

/**
 * Whether Toph Voice is turned on in Android's keyboard settings, mocked: opening the settings
 * "enables" it after a moment. The voice keyboard story makes it real.
 */
export const useKeyboardStore = create<KeyboardState>()((set) => ({
  enabled: false,
  enabling: false,
  enable: () => {
    set({ enabling: true });
    setTimeout(() => set({ enabled: true, enabling: false }), SETTINGS_TRIP_MS);
  },
}));

export function useKeyboardEnabled(): boolean {
  return useKeyboardStore((state) => state.enabled);
}
