import { AppState, Linking, PermissionsAndroid } from 'react-native';
import { create } from 'zustand';

export type PermissionId = 'microphone' | 'notifications';

/** How long a mock system dialog takes to answer, so the request visibly settles. */
const DIALOG_MS = 700;

interface PermissionsState {
  readonly granted: Readonly<Record<PermissionId, boolean>>;
  /** Whether the microphone has been checked once, so nothing decides from the default. */
  readonly checked: boolean;
  readonly requesting: PermissionId | null;
  request(permission: PermissionId): void;
}

/**
 * Android runtime permissions. The microphone is real: it is checked at launch and whenever the
 * app returns to the foreground, and requested through the system dialog. Notifications stay
 * mocked, granted after a moment, until the voice keyboard story.
 */
export const usePermissionsStore = create<PermissionsState>()((set) => ({
  granted: { microphone: false, notifications: false },
  checked: false,
  requesting: null,
  request: (permission) => {
    if (permission === 'microphone') {
      void requestMicrophone();
      return;
    }
    set({ requesting: permission });
    setTimeout(() => {
      set(({ granted }) => ({ granted: { ...granted, [permission]: true }, requesting: null }));
    }, DIALOG_MS);
  },
}));

function setMicrophone(microphone: boolean): void {
  usePermissionsStore.setState(({ granted }) => ({ granted: { ...granted, microphone } }));
}

async function requestMicrophone(): Promise<void> {
  usePermissionsStore.setState({ requesting: 'microphone' });
  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    setMicrophone(result === PermissionsAndroid.RESULTS.GRANTED);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      // The system will not show the dialog again, so its settings screen is the only way left.
      void Linking.openSettings();
    }
  } catch (error) {
    console.warn('[toph:permissions] microphone request failed', error);
  } finally {
    usePermissionsStore.setState({ requesting: null });
  }
}

/** Reads the microphone permission from the system. Always marks it checked, even on failure. */
export async function refreshPermissions(): Promise<void> {
  try {
    setMicrophone(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO));
  } catch (error) {
    console.warn('[toph:permissions] microphone check failed', error);
  } finally {
    usePermissionsStore.setState({ checked: true });
  }
}

// A grant or revoke made in system settings is picked up when the user comes back.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void refreshPermissions();
  }
});

export function usePermission(permission: PermissionId): {
  granted: boolean;
  requesting: boolean;
  request: () => void;
} {
  const granted = usePermissionsStore((state) => state.granted[permission]);
  const requesting = usePermissionsStore((state) => state.requesting === permission);
  const request = usePermissionsStore((state) => state.request);
  return { granted, requesting, request: () => request(permission) };
}

/** Whether the microphone permission has been read from the system at least once. */
export function usePermissionsChecked(): boolean {
  return usePermissionsStore((state) => state.checked);
}
