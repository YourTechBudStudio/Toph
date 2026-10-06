import { useKeyboardEnabled } from '../../keyboard';
import { usePermission } from '../../permissions';
import { usePresetChosen } from '../../polish';
import { useProviderReady } from '../../provider';

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
