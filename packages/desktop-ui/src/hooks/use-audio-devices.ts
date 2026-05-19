import { useEffect, useRef, useState } from 'react';

import {
  SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
  normalizeAudioDeviceLabel,
  type AudioDeviceInfo,
  type AudioDevicePreference,
  type AudioDeviceResolution,
  type AudioDeviceState,
  type SoundEventKind,
} from '@toph/desktop-contracts';

const fallbackInputLabel = 'System Default Microphone';
const fallbackOutputLabel = 'System Default Output';

function toLabel(device: MediaDeviceInfo, fallback: string) {
  return normalizeAudioDeviceLabel(device.label || fallback);
}

async function enumerateAudioDevices(): Promise<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [] };
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({
      id: device.deviceId,
      kind: 'input' as const,
      isDefault: device.deviceId === SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
      label: toLabel(
        device,
        device.deviceId === SYSTEM_DEFAULT_AUDIO_DEVICE_ID
          ? fallbackInputLabel
          : 'Unnamed microphone',
      ),
    }));
  const outputs = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device) => ({
      id: device.deviceId,
      kind: 'output' as const,
      isDefault: device.deviceId === SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
      label: toLabel(
        device,
        device.deviceId === SYSTEM_DEFAULT_AUDIO_DEVICE_ID
          ? fallbackOutputLabel
          : 'Unnamed output',
      ),
    }));

  return { inputs, outputs };
}

function resolveDevice(
  preference: AudioDevicePreference,
  devices: AudioDeviceInfo[],
  fallbackLabel: string,
): AudioDeviceResolution {
  const defaultDevice = devices.find((device) => device.isDefault);
  if (preference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID) {
    return {
      preference,
      resolvedDeviceId: null,
      resolvedLabel: defaultDevice?.label ?? fallbackLabel,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  const selected = devices.find((device) => device.id === preference.id);
  if (selected) {
    return {
      preference,
      resolvedDeviceId: selected.id,
      resolvedLabel: selected.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  return {
    preference,
    resolvedDeviceId: null,
    resolvedLabel: defaultDevice?.label ?? fallbackLabel,
    fallbackUsed: true,
    fallbackReason: 'missing-device',
  };
}

export function buildAudioDeviceState(
  inputPreference: AudioDevicePreference,
  outputPreference: AudioDevicePreference,
  devices: { inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] },
): AudioDeviceState {
  return {
    ...devices,
    input: resolveDevice(inputPreference, devices.inputs, fallbackInputLabel),
    output: resolveDevice(outputPreference, devices.outputs, fallbackOutputLabel),
  };
}

async function getInputStream(preference: AudioDevicePreference) {
  const baseConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  } satisfies MediaTrackConstraints;

  if (preference.id === SYSTEM_DEFAULT_AUDIO_DEVICE_ID) {
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...baseConstraints, deviceId: { exact: preference.id } },
      video: false,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
  }
}

export async function playSoundEvent(kind: SoundEventKind, preference: AudioDevicePreference) {
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return;
  }

  const audioContext = new AudioContextCtor();
  let fallbackUsed = false;
  try {
    if (
      preference.id !== SYSTEM_DEFAULT_AUDIO_DEVICE_ID &&
      'setSinkId' in audioContext &&
      typeof (audioContext as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> })
        .setSinkId === 'function'
    ) {
      await (audioContext as AudioContext & { setSinkId: (sinkId: string) => Promise<void> }).setSinkId(
        preference.id,
      );
    }
  } catch {
    // Missing output devices fall back to the default sink for the current sound.
    fallbackUsed = true;
  }

  const frequencies: Record<SoundEventKind, number[]> = {
    start: [494],
    stop: [392],
    done: [587, 784],
  };
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = kind === 'done' ? 'triangle' : 'sine';
  oscillator.frequency.value = frequencies[kind][0];
  gainNode.gain.value = 0.0001;
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  const now = audioContext.currentTime;
  gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  if (kind === 'done') {
    oscillator.frequency.setValueAtTime(frequencies.done[0], now);
    oscillator.frequency.linearRampToValueAtTime(frequencies.done[1], now + 0.12);
  }
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  oscillator.start(now);
  oscillator.stop(now + 0.26);
  oscillator.onended = () => {
    void audioContext.close();
  };
  return { fallbackUsed };
}

export function playAudioTone(preference: AudioDevicePreference) {
  return playSoundEvent('done', preference);
}

export function useAudioDevices(
  inputPreference: AudioDevicePreference,
  outputPreference: AudioDevicePreference,
) {
  const [devices, setDevices] = useState<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [inputTesting, setInputTesting] = useState(false);
  const [inputEnergy, setInputEnergy] = useState(0);
  const cleanupInputTestRef = useRef<(() => void) | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setDevices(await enumerateAudioDevices());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    const handleDeviceChange = () => {
      void refresh();
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
      cleanupInputTestRef.current?.();
    };
  }, []);

  const stopInputTest = () => {
    cleanupInputTestRef.current?.();
    cleanupInputTestRef.current = null;
    setInputTesting(false);
    setInputEnergy(0);
  };

  const startInputTest = async () => {
    stopInputTest();
    const stream = await getInputStream(inputPreference);
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      setInputEnergy(Math.min(1, rms * 10));
      frame = requestAnimationFrame(tick);
    };

    setInputTesting(true);
    tick();
    cleanupInputTestRef.current = () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    };
  };

  return {
    state: buildAudioDeviceState(inputPreference, outputPreference, devices),
    refreshing,
    inputTesting,
    inputEnergy,
    refresh,
    startInputTest,
    stopInputTest,
    playOutputTest: () => playAudioTone(outputPreference),
  };
}
