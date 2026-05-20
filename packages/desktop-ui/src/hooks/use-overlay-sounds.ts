import { useEffect } from 'react';

import { type AudioDevicePreference, type DesktopApi } from '@toph/desktop-contracts';

import { playSoundEvent } from './use-audio-devices';

export function useOverlaySounds(
  client: DesktopApi,
  enabled: boolean,
  outputDevice: AudioDevicePreference,
  onOutputFallback?: (device: AudioDevicePreference) => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    return client.onSoundEvent((kind) => {
      void playSoundEvent(kind, outputDevice).then((result) => {
        if (result?.fallbackUsed) {
          onOutputFallback?.(outputDevice);
        }
      });
    });
  }, [client, enabled, onOutputFallback, outputDevice]);
}
