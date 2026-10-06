import type { SpeechProbabilityFrame } from '@toph/dictation-core';

import type { StreamingSpeechActivityAnalyzerSession } from './types';

const bytesPerPcm16Sample = 2;

function pcm16ToFloat32Frame(pcm: Buffer, startSample: number, frameSizeSamples: number) {
  const frame = new Float32Array(frameSizeSamples);
  for (let sampleIndex = 0; sampleIndex < frameSizeSamples; sampleIndex += 1) {
    frame[sampleIndex] = pcm.readInt16LE((startSample + sampleIndex) * bytesPerPcm16Sample) / 32768;
  }

  return frame;
}

export class PcmFrameBuffer {
  private pendingPcm = Buffer.alloc(0);
  private processedSamples = 0;

  constructor(
    private readonly options: {
      sampleRate: number;
      frameSizeSamples: number;
      analyzerSession: StreamingSpeechActivityAnalyzerSession;
    },
  ) {}

  async processChunk(chunk: Buffer): Promise<SpeechProbabilityFrame[]> {
    if (chunk.length === 0) {
      return [];
    }

    this.pendingPcm = Buffer.concat([this.pendingPcm, chunk]);
    const frames: SpeechProbabilityFrame[] = [];
    const availableSamples = Math.floor(this.pendingPcm.length / bytesPerPcm16Sample);
    let consumedSamples = 0;

    while (availableSamples - consumedSamples >= this.options.frameSizeSamples) {
      const frameStartSample = this.processedSamples;
      const frame = pcm16ToFloat32Frame(
        this.pendingPcm,
        consumedSamples,
        this.options.frameSizeSamples,
      );
      const speechProbability = await this.options.analyzerSession.scoreFrame(frame);
      const frameEndSample = frameStartSample + this.options.frameSizeSamples;

      frames.push({
        startMs: Math.round((frameStartSample / this.options.sampleRate) * 1000),
        endMs: Math.round((frameEndSample / this.options.sampleRate) * 1000),
        speechProbability,
      });

      consumedSamples += this.options.frameSizeSamples;
      this.processedSamples = frameEndSample;
    }

    this.pendingPcm = this.pendingPcm.subarray(consumedSamples * bytesPerPcm16Sample);
    return frames;
  }

  async flush(): Promise<SpeechProbabilityFrame[]> {
    if (this.pendingPcm.length === 0) {
      await this.options.analyzerSession.flush();
      return [];
    }

    const availableSamples = Math.floor(this.pendingPcm.length / bytesPerPcm16Sample);
    const frame = new Float32Array(this.options.frameSizeSamples);
    for (let sampleIndex = 0; sampleIndex < availableSamples; sampleIndex += 1) {
      frame[sampleIndex] = this.pendingPcm.readInt16LE(sampleIndex * bytesPerPcm16Sample) / 32768;
    }

    const frameStartSample = this.processedSamples;
    const speechProbability = await this.options.analyzerSession.scoreFrame(frame);
    this.processedSamples += availableSamples;
    this.pendingPcm = Buffer.alloc(0);
    await this.options.analyzerSession.flush();

    return [
      {
        startMs: Math.round((frameStartSample / this.options.sampleRate) * 1000),
        endMs: Math.round((this.processedSamples / this.options.sampleRate) * 1000),
        speechProbability,
      },
    ].filter((frameResult) => frameResult.endMs > frameResult.startMs);
  }
}
