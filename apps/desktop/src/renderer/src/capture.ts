import { normalizeAudioDeviceLabel } from '@toph/desktop-contracts';

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let muteNode: GainNode | null = null;
let activeSessionId: string | null = null;

function floatToInt16Pcm(input: Float32Array) {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
}

async function stopCapture() {
  const stoppedSessionId = activeSessionId;

  processorNode?.disconnect();
  muteNode?.disconnect();
  sourceNode?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
  }

  processorNode = null;
  muteNode = null;
  sourceNode = null;
  audioContext = null;
  stream = null;
  activeSessionId = null;

  if (stoppedSessionId) {
    window.tophCapture.sendStopped({ sessionId: stoppedSessionId });
  }
}

async function startCapture({
  sessionId,
  sampleRate,
  inputDeviceId,
}: {
  sessionId: string;
  sampleRate: number;
  inputDeviceId: string | null;
}) {
  if (activeSessionId) {
    await stopCapture();
  }

  activeSessionId = sessionId;

  const audioConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
  };
  let inputDeviceFallbackUsed = false;
  let inputDeviceFallbackLabel: string | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
  } catch (error) {
    if (!inputDeviceId) {
      throw error;
    }

    inputDeviceFallbackUsed = true;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const fallbackTrackLabel = stream.getAudioTracks()[0]?.label;
    inputDeviceFallbackLabel = fallbackTrackLabel
      ? normalizeAudioDeviceLabel(fallbackTrackLabel)
      : null;
  }

  audioContext = new AudioContext({ sampleRate });
  sourceNode = audioContext.createMediaStreamSource(stream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  muteNode = audioContext.createGain();
  muteNode.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    if (!activeSessionId) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    window.tophCapture.sendChunk({
      sessionId: activeSessionId,
      chunk: floatToInt16Pcm(input),
    });
  };

  sourceNode.connect(processorNode);
  processorNode.connect(muteNode);
  muteNode.connect(audioContext.destination);

  window.tophCapture.sendStarted({
    sessionId,
    inputDeviceFallbackUsed,
    inputDeviceFallbackLabel,
  });
}

window.tophCapture.onStart((request) => {
  startCapture(request).catch((error: unknown) => {
    window.tophCapture.sendError({
      sessionId: activeSessionId ?? request.sessionId,
      message: error instanceof Error ? error.message : 'Microphone capture failed.',
    });
  });
});

window.tophCapture.onStop(() => {
  stopCapture().catch((error: unknown) => {
    window.tophCapture.sendError({
      sessionId: activeSessionId,
      message:
        error instanceof Error ? error.message : 'Microphone capture could not stop cleanly.',
    });
  });
});
