import type {
  StreamingSpeechActivityAnalyzer,
  StreamingSpeechActivityAnalyzerSession,
} from './streaming-speech-activity-analyzer';

export interface EnergyStreamingSpeechActivityPolicy {
  frameSizeSamples: number;
  minimumEnergyThreshold: number;
  noiseMultiplier: number;
  noiseAdaptationRate: number;
}

const defaultPolicy: EnergyStreamingSpeechActivityPolicy = {
  frameSizeSamples: 480,
  minimumEnergyThreshold: 0.006,
  noiseMultiplier: 1.8,
  noiseAdaptationRate: 0.05,
};

function calculateRms(frame: Float32Array) {
  let sum = 0;
  for (const sample of frame) {
    sum += sample * sample;
  }

  return Math.sqrt(sum / frame.length);
}

class EnergyStreamingSpeechActivitySession implements StreamingSpeechActivityAnalyzerSession {
  private noiseFloor: number | null = null;

  private readonly policy: EnergyStreamingSpeechActivityPolicy;

  constructor(policy: EnergyStreamingSpeechActivityPolicy) {
    this.policy = policy;
  }

  async scoreFrame(frame: Float32Array) {
    const rms = calculateRms(frame);
    this.noiseFloor ??= rms;
    const threshold = Math.max(
      this.policy.minimumEnergyThreshold,
      this.noiseFloor * this.policy.noiseMultiplier,
    );

    if (rms < threshold) {
      this.noiseFloor =
        this.noiseFloor * (1 - this.policy.noiseAdaptationRate) +
        rms * this.policy.noiseAdaptationRate;
    }

    if (threshold === 0) {
      return 0;
    }

    return Math.max(0, Math.min(1, rms / (threshold * 2)));
  }

  async flush() {}

  async dispose() {}
}

export function createEnergyStreamingSpeechActivityAnalyzer(
  policy: Partial<EnergyStreamingSpeechActivityPolicy> = {},
): StreamingSpeechActivityAnalyzer {
  const resolvedPolicy = { ...defaultPolicy, ...policy };

  return {
    name: 'energy-streaming',
    sampleRate: 16_000,
    frameSizeSamples: resolvedPolicy.frameSizeSamples,

    async createSession() {
      return new EnergyStreamingSpeechActivitySession(resolvedPolicy);
    },
  };
}
