import { useKeyboardEnabled } from '../../keyboard';
import { usePermission, usePermissionsChecked } from '../../permissions';
import { usePolishLoaded, usePresetChosen } from '../../polish';
import { useProviderLoaded, useProviderReady } from '../../provider';

export interface Readiness {
  readonly provider: boolean;
  readonly microphone: boolean;
  readonly keyboard: boolean;
  readonly writingStyle: boolean;
  readonly ready: boolean;
}

/**
 * The prerequisites for using Toph: a working provider, the microphone, the Toph Voice keyboard
 * turned on, and a chosen writing style. Notifications are optional, so they are not here.
 */
export function useReadiness(): Readiness {
  const provider = useProviderReady();
  const microphone = usePermission('microphone').granted;
  const keyboard = useKeyboardEnabled();
  const writingStyle = usePresetChosen();
  return {
    provider,
    microphone,
    keyboard,
    writingStyle,
    ready: provider && microphone && keyboard && writingStyle,
  };
}

/** Whether the gate's stored and system inputs have been read, so it never decides from defaults. */
export function useReadinessSettled(): boolean {
  // Every hook runs on every render; `&&` between the calls would skip the later ones and break
  // React's hook order once the provider finishes loading.
  const providerLoaded = useProviderLoaded();
  const permissionsChecked = usePermissionsChecked();
  const polishLoaded = usePolishLoaded();
  return providerLoaded && permissionsChecked && polishLoaded;
}
