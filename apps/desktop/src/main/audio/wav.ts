import { closeSync, openSync, writeSync } from 'node:fs';
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const wavHeaderBytes = 44;
const pcmFormat = 1;
const expectedSampleRate = 16_000;
const expectedChannelCount = 1;
const expectedBitsPerSample = 16;

export interface PcmWavFile {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  pcm: Buffer;
  durationMs: number;
}

export interface Pcm16MonoWavWriterResult {
  outputPath: string;
  durationMs: number;
  bytesWritten: number;
}

function writeWavHeader(dataBytes: number) {
  const header = Buffer.alloc(wavHeaderBytes);
  const byteRate = expectedSampleRate * expectedChannelCount * (expectedBitsPerSample / 8);
  const blockAlign = expectedChannelCount * (expectedBitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(pcmFormat, 20);
  header.writeUInt16LE(expectedChannelCount, 22);
  header.writeUInt32LE(expectedSampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(expectedBitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

export async function readPcm16MonoWav(filePath: string): Promise<PcmWavFile> {
  const file = await readFile(filePath);
  if (file.length < wavHeaderBytes) {
    throw new Error('WAV file is too small to contain a valid header.');
  }

  const riff = file.toString('ascii', 0, 4);
  const wave = file.toString('ascii', 8, 12);
  const fmt = file.toString('ascii', 12, 16);
  const data = file.toString('ascii', 36, 40);
  const audioFormat = file.readUInt16LE(20);
  const channelCount = file.readUInt16LE(22);
  const sampleRate = file.readUInt32LE(24);
  const bitsPerSample = file.readUInt16LE(34);
  const dataBytes = file.readUInt32LE(40);

  if (riff !== 'RIFF' || wave !== 'WAVE' || fmt !== 'fmt ' || data !== 'data') {
    throw new Error('WAV file is not the simple PCM layout produced by Toph.');
  }

  if (
    audioFormat !== pcmFormat ||
    channelCount !== expectedChannelCount ||
    sampleRate !== expectedSampleRate ||
    bitsPerSample !== expectedBitsPerSample
  ) {
    throw new Error('WAV file must be 16 kHz mono 16-bit PCM.');
  }

  const pcmEnd = wavHeaderBytes + dataBytes;
  if (pcmEnd > file.length) {
    throw new Error('WAV file data chunk is incomplete.');
  }

  const pcm = file.subarray(wavHeaderBytes, pcmEnd);
  return {
    sampleRate,
    channelCount,
    bitsPerSample,
    pcm,
    durationMs: Math.round((pcm.length / 2 / sampleRate) * 1000),
  };
}

export async function writePcm16MonoWav(filePath: string, pcm: Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.concat([writeWavHeader(pcm.length), pcm]));
}

export class Pcm16MonoWavWriter {
  private readonly fd: number;
  private readonly outputPath: string;
  private dataBytes = 0;
  private finalized = false;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    this.fd = openSync(outputPath, 'w');
    const header = writeWavHeader(0);
    writeSync(this.fd, header, 0, header.length, 0);
  }

  write(chunk: Buffer) {
    if (this.finalized) {
      throw new Error('WAV writer has already been finalized.');
    }

    writeSync(this.fd, chunk, 0, chunk.length, wavHeaderBytes + this.dataBytes);
    this.dataBytes += chunk.length;
  }

  finalize(): Pcm16MonoWavWriterResult {
    if (this.finalized) {
      return this.result();
    }

    const header = writeWavHeader(this.dataBytes);
    writeSync(this.fd, header, 0, header.length, 0);
    closeSync(this.fd);
    this.finalized = true;
    return this.result();
  }

  private result(): Pcm16MonoWavWriterResult {
    return {
      outputPath: this.outputPath,
      bytesWritten: this.dataBytes + wavHeaderBytes,
      durationMs: Math.round((this.dataBytes / 2 / expectedSampleRate) * 1000),
    };
  }
}

export async function readPcm16MonoWavRanges(options: {
  filePath: string;
  ranges: Array<{ startMs: number; endMs: number }>;
  sampleRate?: number;
}): Promise<Buffer[]> {
  const sampleRate = options.sampleRate ?? expectedSampleRate;
  const file = await open(options.filePath, 'r');

  try {
    const chunks: Buffer[] = [];
    for (const range of options.ranges) {
      const start = wavHeaderBytes + msToPcmByteOffset(range.startMs, sampleRate);
      const end = wavHeaderBytes + msToPcmByteOffset(range.endMs, sampleRate);
      const length = Math.max(0, end - start);
      if (length === 0) {
        continue;
      }

      const chunk = Buffer.alloc(length);
      let bytesRead = 0;
      while (bytesRead < length) {
        const result = await file.read({
          buffer: chunk,
          offset: bytesRead,
          length: length - bytesRead,
          position: start + bytesRead,
        });
        if (result.bytesRead === 0) {
          throw new Error(
            `Raw WAV range ${range.startMs}-${range.endMs}ms is not fully available for debug audio generation.`,
          );
        }
        bytesRead += result.bytesRead;
      }
      chunks.push(chunk);
    }

    return chunks;
  } finally {
    await file.close();
  }
}

export function msToPcmByteOffset(ms: number, sampleRate: number): number {
  const sampleIndex = Math.max(0, Math.round((ms / 1000) * sampleRate));
  return sampleIndex * 2;
}

export function slicePcmByTime(
  pcm: Buffer,
  sampleRate: number,
  startMs: number,
  endMs: number,
): Buffer {
  const start = Math.min(pcm.length, msToPcmByteOffset(startMs, sampleRate));
  const end = Math.min(pcm.length, msToPcmByteOffset(endMs, sampleRate));
  return pcm.subarray(start, Math.max(start, end));
}
