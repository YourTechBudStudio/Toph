import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { desktopCapturer, nativeImage, screen, systemPreferences } from 'electron';

import type {
  AppSettings,
  ScreenshotContextDuplicateReference,
  ScreenshotContextImage,
  ScreenshotContextState,
} from '@toph/desktop-contracts';

import {
  compareScreenshotFingerprints,
  createScreenshotFingerprintFromBgraBitmap,
  isDuplicateScreenshotDiff,
  screenshotFingerprintHeight,
  screenshotFingerprintWidth,
  type ScreenshotFingerprint,
} from './screenshot-diff';

export interface ScreenshotContextSession {
  start: () => void;
  capture: () => Promise<void>;
  stop: () => Promise<ScreenshotContextImage[]>;
  dispose: () => Promise<void>;
  listImages: () => ScreenshotContextImage[];
}

export interface ScreenshotContextService {
  inspectState: (settings: AppSettings, capturedCount?: number) => ScreenshotContextState;
  requestPermission: (settings: AppSettings) => Promise<ScreenshotContextState>;
  createSession: (options: {
    settings: AppSettings;
    rawAudioPath: string;
    onStateChanged: (state: ScreenshotContextState) => void;
  }) => ScreenshotContextSession;
  listImagesForSession: (
    settings: AppSettings | null,
    rawAudioPath: string,
  ) => Promise<ScreenshotContextImage[]>;
}

const maxScreenshotsPerSession = 6;
const maxScreenshotWidth = 1280;
const maxScreenshotHeight = 900;
const jpegQuality = 72;
const screenshotDetail = 'high' as const;
const manifestFileName = 'context-manifest.json';

interface ScreenshotCaptureCandidate {
  image: ScreenshotContextImage;
  bytes: Buffer;
  fingerprint: ScreenshotFingerprint;
}

interface AcceptedScreenshotCapture {
  image: ScreenshotContextImage;
  fingerprint: ScreenshotFingerprint;
}

interface ScreenshotContextManifest {
  version: 1;
  duplicateReferences: ScreenshotContextDuplicateReference[];
}

function disabledState(): ScreenshotContextState {
  return {
    enabled: false,
    status: 'disabled',
    detail: 'Screenshot context is off.',
    action: 'none',
    capturedCount: 0,
  };
}

function unavailableState(enabled: boolean, detail: string): ScreenshotContextState {
  return {
    enabled,
    status: 'unavailable',
    detail,
    action: 'none',
    capturedCount: 0,
  };
}

function getScreenshotsDirectory(rawAudioPath: string) {
  return join(dirname(rawAudioPath), 'screenshots');
}

function getScreenshotsManifestPath(rawAudioPath: string) {
  return join(getScreenshotsDirectory(rawAudioPath), manifestFileName);
}

function formatScreenshotPath(rawAudioPath: string, sequence: number) {
  return join(
    getScreenshotsDirectory(rawAudioPath),
    `context-${String(sequence).padStart(2, '0')}.jpg`,
  );
}

function inspectScreenPermission() {
  if (process.platform !== 'darwin') {
    return 'granted';
  }

  return systemPreferences.getMediaAccessStatus('screen');
}

function formatReadyDetail(capturedCount: number, duplicateCount: number) {
  if (capturedCount === 0) {
    return duplicateCount > 0
      ? `Screenshot context is ready. Skipped ${duplicateCount} similar frame${duplicateCount === 1 ? '' : 's'}.`
      : 'Screenshot context is ready. Capture manually while listening.';
  }

  const captured =
    `Screenshot context is ready with ${capturedCount} captured image` +
    `${capturedCount === 1 ? '' : 's'}.`;
  if (duplicateCount === 0) {
    return captured;
  }

  return `${captured} Skipped ${duplicateCount} similar frame${duplicateCount === 1 ? '' : 's'}.`;
}

function createReadyState(
  enabled: boolean,
  capturedCount: number,
  duplicateCount = 0,
): ScreenshotContextState {
  return {
    enabled,
    status: 'ready',
    detail: formatReadyDetail(capturedCount, duplicateCount),
    action: 'none',
    capturedCount,
  };
}

function inspectState(settings: AppSettings, capturedCount = 0): ScreenshotContextState {
  const enabled = settings.context.screenshots.enabled;
  if (!enabled) {
    return disabledState();
  }

  if (!settings.polish.enabled) {
    return unavailableState(true, 'Screenshot context needs Polish Dictation to be enabled.');
  }

  const permission = inspectScreenPermission();
  if (permission === 'granted') {
    return createReadyState(true, capturedCount);
  }

  if (process.platform === 'darwin') {
    const promptable = permission === 'not-determined' || permission === 'unknown';
    return {
      enabled: true,
      status: 'permission-needed',
      detail: promptable
        ? 'Screen Recording access is needed before screenshots can be captured. Request it here.'
        : 'Screen Recording is blocked. Enable Toph in macOS Privacy & Security > Screen Recording.',
      action: promptable ? 'request' : 'open-settings',
      capturedCount,
    };
  }

  return unavailableState(true, 'Screenshot context is not available in this session.');
}

function createCaptureSize() {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const scale = Math.min(
    1,
    maxScreenshotWidth / display.size.width,
    maxScreenshotHeight / display.size.height,
  );

  return {
    displayId: String(display.id),
    size: {
      width: Math.max(1, Math.round(display.size.width * scale)),
      height: Math.max(1, Math.round(display.size.height * scale)),
    },
  };
}

function roundDiffMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function writeManifest(
  rawAudioPath: string,
  duplicateReferences: ScreenshotContextDuplicateReference[],
) {
  if (duplicateReferences.length === 0) {
    return;
  }

  const manifest: ScreenshotContextManifest = {
    version: 1,
    duplicateReferences,
  };
  await mkdir(getScreenshotsDirectory(rawAudioPath), { recursive: true });
  await writeFile(getScreenshotsManifestPath(rawAudioPath), JSON.stringify(manifest, null, 2));
}

async function readDuplicateReferences(rawAudioPath: string) {
  let raw: string;
  try {
    raw = await readFile(getScreenshotsManifestPath(rawAudioPath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ScreenshotContextManifest>;
    if (!Array.isArray(parsed.duplicateReferences)) {
      return [];
    }

    return parsed.duplicateReferences.filter((reference) => {
      return (
        typeof reference?.capturedAt === 'number' &&
        typeof reference.referencePath === 'string' &&
        typeof reference.meanAbsoluteDifference === 'number' &&
        typeof reference.changedPixelRatio === 'number'
      );
    });
  } catch {
    return [];
  }
}

function attachDuplicateReference(
  images: ScreenshotContextImage[],
  duplicateReference: ScreenshotContextDuplicateReference,
) {
  const referencedImage = images.find((image) => image.path === duplicateReference.referencePath);
  if (!referencedImage) {
    return;
  }

  referencedImage.duplicateReferences = [
    ...(referencedImage.duplicateReferences ?? []),
    duplicateReference,
  ];
}

function findDuplicateReference(
  acceptedCaptures: AcceptedScreenshotCapture[],
  candidate: ScreenshotCaptureCandidate,
): ScreenshotContextDuplicateReference | null {
  let bestMatch: {
    image: ScreenshotContextImage;
    meanAbsoluteDifference: number;
    changedPixelRatio: number;
  } | null = null;

  for (const accepted of acceptedCaptures) {
    const diff = compareScreenshotFingerprints(accepted.fingerprint, candidate.fingerprint);
    if (!isDuplicateScreenshotDiff(diff)) {
      continue;
    }

    if (!bestMatch || diff.meanAbsoluteDifference < bestMatch.meanAbsoluteDifference) {
      bestMatch = {
        image: accepted.image,
        meanAbsoluteDifference: diff.meanAbsoluteDifference,
        changedPixelRatio: diff.changedPixelRatio,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    capturedAt: candidate.image.capturedAt,
    referencePath: bestMatch.image.path,
    meanAbsoluteDifference: roundDiffMetric(bestMatch.meanAbsoluteDifference),
    changedPixelRatio: roundDiffMetric(bestMatch.changedPixelRatio),
  };
}

async function captureActiveDisplay(
  rawAudioPath: string,
  sequence: number,
): Promise<ScreenshotCaptureCandidate> {
  const { displayId, size } = createCaptureSize();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: size,
    fetchWindowIcons: false,
  });
  const source = sources.find((candidate) => candidate.display_id === displayId) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('No active display screenshot source was available.');
  }

  const path = formatScreenshotPath(rawAudioPath, sequence);
  const bytes = source.thumbnail.toJPEG(jpegQuality);
  const imageSize = source.thumbnail.getSize();
  const fingerprintImage = source.thumbnail.resize({
    width: screenshotFingerprintWidth,
    height: screenshotFingerprintHeight,
    quality: 'good',
  });
  const fingerprint = createScreenshotFingerprintFromBgraBitmap(
    fingerprintImage.toBitmap(),
    screenshotFingerprintWidth,
    screenshotFingerprintHeight,
  );

  return {
    image: {
      path,
      mimeType: 'image/jpeg' as const,
      detail: screenshotDetail,
      capturedAt: Date.now(),
      width: imageSize.width,
      height: imageSize.height,
      byteSize: bytes.byteLength,
    },
    bytes,
    fingerprint,
  };
}

async function requestScreenPermissionPreflight() {
  if (process.platform !== 'darwin' || inspectScreenPermission() === 'granted') {
    return;
  }

  await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  });
}

function createInertSession(): ScreenshotContextSession {
  return {
    start() {},
    capture() {
      return Promise.resolve();
    },
    async stop() {
      return [];
    },
    async dispose() {},
    listImages() {
      return [];
    },
  };
}

export function createScreenshotContextService(): ScreenshotContextService {
  return {
    inspectState,

    async requestPermission(settings) {
      try {
        await requestScreenPermissionPreflight();
      } catch {
        // macOS may reject the preflight when access is denied. The follow-up
        // inspectState call reports the current status and settings action.
      }

      return inspectState(settings);
    },

    createSession({ settings, rawAudioPath, onStateChanged }) {
      const initialState = inspectState(settings);
      onStateChanged(initialState);
      if (initialState.status !== 'ready') {
        return createInertSession();
      }

      let disposed = false;
      let captureQueue: Promise<unknown> = Promise.resolve();
      const images: ScreenshotContextImage[] = [];
      const acceptedCaptures: AcceptedScreenshotCapture[] = [];
      const duplicateReferences: ScreenshotContextDuplicateReference[] = [];

      const publish = (state: ScreenshotContextState) => {
        onStateChanged({ ...state, capturedCount: images.length });
      };

      const captureOnce = () => {
        captureQueue = captureQueue
          .catch(() => {})
          .then(async () => {
            if (disposed) {
              return;
            }

            if (images.length >= maxScreenshotsPerSession) {
              publish({
                enabled: true,
                status: 'ready',
                detail: `Screenshot limit reached (${maxScreenshotsPerSession}/${maxScreenshotsPerSession}).`,
                action: 'none',
                capturedCount: images.length,
              });
              return;
            }

            publish({
              enabled: true,
              status: 'capturing',
              detail: 'Capturing screenshot context...',
              action: 'none',
              capturedCount: images.length,
            });

            try {
              const candidate = await captureActiveDisplay(rawAudioPath, images.length + 1);
              const duplicateReference = findDuplicateReference(acceptedCaptures, candidate);
              if (duplicateReference) {
                duplicateReferences.push(duplicateReference);
                attachDuplicateReference(images, duplicateReference);
                await writeManifest(rawAudioPath, duplicateReferences);
                publish({
                  enabled: true,
                  status: 'ready',
                  detail: `Similar screenshot skipped. Using ${images.length} captured image${images.length === 1 ? '' : 's'}.`,
                  action: 'none',
                  capturedCount: images.length,
                });
                return;
              }

              await mkdir(dirname(candidate.image.path), { recursive: true });
              await writeFile(candidate.image.path, candidate.bytes);
              images.push(candidate.image);
              acceptedCaptures.push({
                image: candidate.image,
                fingerprint: candidate.fingerprint,
              });
              await writeManifest(rawAudioPath, duplicateReferences);
              publish({
                enabled: true,
                status: 'ready',
                detail: `Screenshot captured (${images.length}/${maxScreenshotsPerSession}).`,
                action: 'none',
                capturedCount: images.length,
              });
            } catch (error) {
              publish({
                enabled: true,
                status: inspectScreenPermission() === 'granted' ? 'error' : 'permission-needed',
                detail:
                  error instanceof Error
                    ? `Screenshot context could not be captured. ${error.message}`
                    : 'Screenshot context could not be captured.',
                action: process.platform === 'darwin' ? 'open-settings' : 'none',
                capturedCount: images.length,
              });
            }
          });

        return captureQueue;
      };

      return {
        start() {
          if (disposed) {
            return;
          }

          publish(createReadyState(true, images.length, duplicateReferences.length));
        },

        async capture() {
          await captureOnce();
        },

        async stop() {
          await captureQueue.catch(() => {});
          disposed = true;
          publish(createReadyState(true, images.length, duplicateReferences.length));
          return [...images];
        },

        async dispose() {
          disposed = true;
          await captureQueue.catch(() => {});
        },

        listImages() {
          return [...images];
        },
      };
    },

    async listImagesForSession(settings, rawAudioPath) {
      if (settings && inspectState(settings).status !== 'ready') {
        return [];
      }

      const directory = getScreenshotsDirectory(rawAudioPath);
      let entries: string[];
      try {
        entries = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }

        throw error;
      }

      const duplicateReferences = await readDuplicateReferences(rawAudioPath);
      const duplicateReferencesByPath = new Map<string, ScreenshotContextDuplicateReference[]>();
      for (const reference of duplicateReferences) {
        duplicateReferencesByPath.set(reference.referencePath, [
          ...(duplicateReferencesByPath.get(reference.referencePath) ?? []),
          reference,
        ]);
      }

      const images = await Promise.all(
        entries
          .filter((entry) => /^context-\d+\.jpg$/.test(entry))
          .sort()
          .slice(0, maxScreenshotsPerSession)
          .map(async (entry) => {
            const path = join(directory, entry);
            const [metadata, image] = await Promise.all([
              stat(path),
              Promise.resolve(nativeImage.createFromPath(path)),
            ]);
            const imageSize = image.getSize();
            const imageDuplicateReferences = duplicateReferencesByPath.get(path) ?? [];
            return {
              path,
              mimeType: 'image/jpeg' as const,
              detail: screenshotDetail,
              capturedAt: metadata.mtimeMs,
              width: imageSize.width || undefined,
              height: imageSize.height || undefined,
              byteSize: metadata.size,
              duplicateReferences:
                imageDuplicateReferences.length > 0 ? imageDuplicateReferences : undefined,
            };
          }),
      );

      return images;
    },
  };
}
