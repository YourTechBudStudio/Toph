import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';

export type PermissionId = 'microphone' | 'notifications';

const PERMISSION_IDS = ['microphone', 'notifications'] as const satisfies readonly PermissionId[];

const SYSTEM_PERMISSION = {
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  notifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
} as const;

/**
 * Android 13 (API 33) made notifications a runtime permission; before that they are on by default.
 * Asking for it there would read as "never ask again" and send the user to app settings for nothing.
 */
const isRuntimePermission = (permission: PermissionId): boolean =>
  permission !== 'notifications' || Number(Platform.Version) >= 33;

interface PermissionsState {
  readonly granted: Readonly<Record<PermissionId, boolean>>;
  /** Whether the permissions have been read from the system at least once, so nothing decides from the default. */
  readonly checked: boolean;
  readonly requesting: PermissionId | null;
  request(permission: PermissionId): void;
}

/**
 * Android runtime permissions, both real: read from the system at launch and whenever the app
 * returns to the foreground, and requested through the system dialog.
 */
export const usePermissionsStore = create<PermissionsState>()(() => ({
  granted: { microphone: false, notifications: false },
  checked: false,
  requesting: null,
  request: (permission) => void requestPermission(permission),
}));

function setGranted(permission: PermissionId, value: boolean): void {
  usePermissionsStore.setState(({ granted }) => ({ granted: { ...granted, [permission]: value } }));
}

async function requestPermission(permission: PermissionId): Promise<void> {
  if (!isRuntimePermission(permission)) {
    return; // it already reads as granted
  }
  usePermissionsStore.setState({ requesting: permission });
  try {
    const result = await PermissionsAndroid.request(SYSTEM_PERMISSION[permission]);
    setGranted(permission, result === PermissionsAndroid.RESULTS.GRANTED);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      // The system will not show the dialog again, so its settings screen is the only way left.
      void Linking.openSettings();
    }
  } catch (error) {
    console.warn(`[toph:permissions] ${permission} request failed`, error);
  } finally {
    usePermissionsStore.setState({ requesting: null });
  }
}

function readPermission(permission: PermissionId): Promise<boolean> {
  if (!isRuntimePermission(permission)) {
    return Promise.resolve(true);
  }
  return PermissionsAndroid.check(SYSTEM_PERMISSION[permission]);
}

/** Reads every permission from the system. Always marks them checked, even on failure. */
export async function refreshPermissions(): Promise<void> {
  await Promise.all(
    PERMISSION_IDS.map(async (permission) => {
      try {
        setGranted(permission, await readPermission(permission));
      } catch (error) {
        console.warn(`[toph:permissions] ${permission} check failed`, error);
      }
    }),
  );
  usePermissionsStore.setState({ checked: true });
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

/** Whether the permissions have been read from the system at least once. */
export function usePermissionsChecked(): boolean {
  return usePermissionsStore((state) => state.checked);
}
