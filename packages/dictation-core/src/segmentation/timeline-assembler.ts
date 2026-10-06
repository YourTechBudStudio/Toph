import { createId } from '../ids';
import type { SpeechProbabilityFrame, TimelineRegionDraft, TimelineRegionKind } from './types';

export interface TimelineAssemblerPolicy {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  safeSilenceMs: number;
  minSpeechMs: number;
  silenceEmitIntervalMs: number;
}

const defaultPolicy: TimelineAssemblerPolicy = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  safeSilenceMs: 700,
  minSpeechMs: 250,
  silenceEmitIntervalMs: 500,
};

interface OpenRegion {
  kind: TimelineRegionKind;
  startMs: number;
  endMs: number;
  confidenceSum: number;
  frameCount: number;
}

function averageConfidence(region: OpenRegion) {
  if (region.frameCount === 0) {
    return null;
  }

  return Math.round((region.confidenceSum / region.frameCount) * 1000);
}

export class TimelineAssembler {
  private readonly policy: TimelineAssemblerPolicy;
  private currentRegion: OpenRegion | null = null;
  private nextSequence = 0;
  private speechSilenceStartMs: number | null = null;
  private speechSilenceEndMs: number | null = null;

  constructor(options: { createdLive: boolean; policy?: Partial<TimelineAssemblerPolicy> }) {
    this.createdLive = options.createdLive;
    this.policy = { ...defaultPolicy, ...options.policy };
  }

  private readonly createdLive: boolean;

  processFrames(frames: SpeechProbabilityFrame[]): TimelineRegionDraft[] {
    const finalized: TimelineRegionDraft[] = [];
    for (const frame of frames) {
      finalized.push(...this.processFrame(frame));
    }

    return finalized;
  }

  flush(): TimelineRegionDraft[] {
    if (!this.currentRegion) {
      return [];
    }

    const region = this.finalizeRegion(this.currentRegion);
    this.currentRegion = null;
    this.speechSilenceStartMs = null;
    this.speechSilenceEndMs = null;
    return region ? [region] : [];
  }

  private processFrame(frame: SpeechProbabilityFrame): TimelineRegionDraft[] {
    if (!this.currentRegion) {
      this.currentRegion = this.createOpenRegion(
        frame.speechProbability >= this.policy.positiveSpeechThreshold ? 'speech' : 'silence',
        frame,
      );
      return [];
    }

    if (this.currentRegion.kind === 'speech') {
      return this.processFrameDuringSpeech(frame);
    }

    return this.processFrameDuringSilence(frame);
  }

  private processFrameDuringSpeech(frame: SpeechProbabilityFrame): TimelineRegionDraft[] {
    if (frame.speechProbability >= this.policy.negativeSpeechThreshold) {
      this.extendCurrentRegion(frame);
      this.speechSilenceStartMs = null;
      this.speechSilenceEndMs = null;
      return [];
    }

    this.speechSilenceStartMs ??= frame.startMs;
    this.speechSilenceEndMs = frame.endMs;
    this.extendCurrentRegion(frame);

    if (this.speechSilenceEndMs - this.speechSilenceStartMs < this.policy.safeSilenceMs) {
      return [];
    }

    const speechEndMs = this.speechSilenceStartMs;
    const speechRegion = this.currentRegion!;
    speechRegion.endMs = speechEndMs;

    const finalizedSpeech = this.finalizeRegion(speechRegion);
    this.currentRegion = {
      kind: 'silence',
      startMs: speechEndMs,
      endMs: frame.endMs,
      confidenceSum: 1 - frame.speechProbability,
      frameCount: 1,
    };
    this.speechSilenceStartMs = null;
    this.speechSilenceEndMs = null;

    return finalizedSpeech ? [finalizedSpeech] : [];
  }

  private processFrameDuringSilence(frame: SpeechProbabilityFrame): TimelineRegionDraft[] {
    if (frame.speechProbability >= this.policy.positiveSpeechThreshold) {
      const finalizedSilence = this.finalizeRegion(this.currentRegion!);
      this.currentRegion = this.createOpenRegion('speech', frame);
      return finalizedSilence ? [finalizedSilence] : [];
    }

    this.extendCurrentRegion(frame);
    if (
      this.currentRegion!.endMs - this.currentRegion!.startMs <
      this.policy.silenceEmitIntervalMs
    ) {
      return [];
    }

    const finalizedSilence = this.finalizeRegion(this.currentRegion!);
    this.currentRegion = {
      kind: 'silence',
      startMs: frame.endMs,
      endMs: frame.endMs,
      confidenceSum: 0,
      frameCount: 0,
    };

    return finalizedSilence ? [finalizedSilence] : [];
  }

  private createOpenRegion(kind: TimelineRegionKind, frame: SpeechProbabilityFrame): OpenRegion {
    return {
      kind,
      startMs: frame.startMs,
      endMs: frame.endMs,
      confidenceSum: kind === 'speech' ? frame.speechProbability : 1 - frame.speechProbability,
      frameCount: 1,
    };
  }

  private extendCurrentRegion(frame: SpeechProbabilityFrame) {
    if (!this.currentRegion) {
      return;
    }

    this.currentRegion.endMs = frame.endMs;
    this.currentRegion.confidenceSum +=
      this.currentRegion.kind === 'speech' ? frame.speechProbability : 1 - frame.speechProbability;
    this.currentRegion.frameCount += 1;
  }

  private finalizeRegion(region: OpenRegion): TimelineRegionDraft | null {
    if (region.endMs <= region.startMs) {
      return null;
    }

    if (region.kind === 'speech' && region.endMs - region.startMs < this.policy.minSpeechMs) {
      return null;
    }

    return {
      id: createId('region'),
      sequence: this.nextSequence++,
      kind: region.kind,
      startMs: region.startMs,
      endMs: region.endMs,
      confidence: averageConfidence(region),
      createdLive: this.createdLive,
    };
  }
}
