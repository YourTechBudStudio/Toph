import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Pcm16MonoWavWriter } from '../audio/wav';

const dictationAudioFileName = 'dictation.wav';
const promptAudioFileName = 'dictation-prompt.wav';
const promptTextFileName = 'dictation-prompt.txt';

export interface DictationPromptCaptureResult {
  dictationAudioPath: string;
  promptAudioPath: string | null;
  promptDurationMs: number;
}

export interface DictationPromptCaptureSession {
  readonly dictationAudioPath: string;
  readonly promptAudioPath: string;
  isCapturing: () => boolean;
  startPromptCapture: () => void;
  stopPromptCapture: () => void;
  writeDictationChunk: (chunk: Buffer) => void;
  writePromptChunk: (chunk: Buffer) => void;
  finish: () => Promise<DictationPromptCaptureResult>;
  dispose: () => void;
}

export function getDictationPromptArtifactPaths(rawAudioPath: string) {
  const directory = dirname(rawAudioPath);
  return {
    dictationAudioPath: join(directory, dictationAudioFileName),
    promptAudioPath: join(directory, promptAudioFileName),
    promptTextPath: join(directory, promptTextFileName),
  };
}

export async function resolveDictationAudioPath(rawAudioPath: string): Promise<string> {
  const { dictationAudioPath } = getDictationPromptArtifactPaths(rawAudioPath);
  try {
    await stat(dictationAudioPath);
    return dictationAudioPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    return rawAudioPath;
  }
}

export async function readDictationPromptText(rawAudioPath: string): Promise<string | null> {
  const { promptTextPath } = getDictationPromptArtifactPaths(rawAudioPath);
  try {
    const text = await readFile(promptTextPath, 'utf8');
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writeDictationPromptText(
  rawAudioPath: string,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const { promptTextPath } = getDictationPromptArtifactPaths(rawAudioPath);
  await writeFile(promptTextPath, `${trimmed}\n`, { mode: 0o600 });
  return trimmed;
}

export function createDictationPromptCaptureSession(
  rawAudioPath: string,
): DictationPromptCaptureSession {
  const { dictationAudioPath, promptAudioPath } = getDictationPromptArtifactPaths(rawAudioPath);
  const dictationWriter = new Pcm16MonoWavWriter(dictationAudioPath);
  let promptWriter: Pcm16MonoWavWriter | null = null;
  let promptActive = false;
  let promptFinalized = false;
  let promptDurationMs = 0;

  const ensurePromptWriter = () => {
    promptWriter ??= new Pcm16MonoWavWriter(promptAudioPath);
    return promptWriter;
  };

  return {
    dictationAudioPath,
    promptAudioPath,

    isCapturing() {
      return promptActive;
    },

    startPromptCapture() {
      if (promptFinalized) {
        return;
      }

      promptActive = true;
    },

    stopPromptCapture() {
      promptActive = false;
    },

    writeDictationChunk(chunk) {
      dictationWriter.write(chunk);
    },

    writePromptChunk(chunk) {
      ensurePromptWriter().write(chunk);
    },

    async finish() {
      promptActive = false;
      const dictation = dictationWriter.finalize();
      const prompt = promptWriter?.finalize() ?? null;
      promptFinalized = true;
      promptDurationMs = prompt?.durationMs ?? 0;

      return {
        dictationAudioPath: dictation.outputPath,
        promptAudioPath: prompt && prompt.durationMs > 0 ? prompt.outputPath : null,
        promptDurationMs,
      };
    },

    dispose() {
      promptActive = false;
      try {
        dictationWriter.finalize();
      } catch {
        // Cleanup is best effort; session artifact deletion handles the files.
      }
      try {
        promptWriter?.finalize();
      } catch {
        // Cleanup is best effort; session artifact deletion handles the files.
      }
      promptFinalized = true;
    },
  };
}
