import { create } from 'zustand';

export type PermissionId = 'microphone' | 'notifications';

/** How long a mock system dialog takes to answer, so the request visibly settles. */
const DIALOG_MS = 700;

interface PermissionsState {
  readonly granted: Readonly<Record<PermissionId, boolean>>;
  readonly requesting: PermissionId | null;
  request(permission: PermissionId): void;
}

/**
 * Android runtime permissions, mocked: every request is granted after a moment. The voice keyboard
 * story replaces this with the real permission APIs.
 */
export const usePermissionsStore = create<PermissionsState>()((set) => ({
  granted: { microphone: false, notifications: false },
  requesting: null,
  request: (permission) => {
    set({ requesting: permission });
    setTimeout(() => {
      set(({ granted }) => ({ granted: { ...granted, [permission]: true }, requesting: null }));
    }, DIALOG_MS);
  },
}));

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
