import { Collapsible } from '@base-ui/react/collapsible';
import {
  AlertTriangle,
  Check,
  Copy,
  Image as ImageIcon,
  MessageSquareText,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DesktopApi,
  DictationSessionRecord,
  PolishRulePresetSummary,
  ScreenshotContextImage,
} from '@toph/desktop-contracts';

import { useRelativeTime } from '../hooks/use-desktop-state';
import { ModalShell } from './modal';

const actionButtonClass =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-transparent text-text-tertiary transition-all duration-200 ease-out hover:bg-white/8 hover:text-text-primary focus:bg-white/8 focus:text-text-primary focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-45';
const deleteButtonClass =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-accent-red/12 text-accent-red transition-all duration-200 ease-out hover:bg-accent-red/18 hover:text-accent-red focus:bg-accent-red/18 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-45';

function toFileUrl(path: string) {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

function formatByteSize(byteSize?: number) {
  if (typeof byteSize !== 'number') return 'unknown size';
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function formatImageSize(width?: number, height?: number) {
  if (!width || !height) return 'unknown dimensions';
  return `${width}x${height}`;
}

function formatAbsoluteTime(timestamp: number | null | undefined) {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return 'n/a';
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}

export function DictationCard({
  session,
  rulePresets,
  client,
  diagnosticsEnabled,
}: {
  session: DictationSessionRecord;
  rulePresets: PolishRulePresetSummary[];
  client: DesktopApi;
  diagnosticsEnabled: boolean;
}) {
  const relativeTime = useRelativeTime(session.createdAt);
  const output = session.selectedOutput;
  const rulePresetTitle = rulePresets.find((preset) => preset.id === output?.rulePresetId)?.title;
  const [justCopied, setJustCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'transcript' | 'error' | null>(null);
  const [pendingAction, setPendingAction] = useState<'rerun' | 'delete' | null>(null);
  const [previewScreenshot, setPreviewScreenshot] = useState<{
    screenshot: ScreenshotContextImage;
    index: number;
  } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const copyText = useCallback((text: string, kind: 'transcript' | 'error') => {
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }

    navigator.clipboard
      .writeText(text)
      .then(
        () => {
          setJustCopied(true);
          setCopyFailed(false);
          setCopiedKind(kind);
        },
        () => {
          setJustCopied(true);
          setCopyFailed(true);
          setCopiedKind(kind);
        },
      )
      .finally(() => {
        copyTimerRef.current = setTimeout(() => {
          setJustCopied(false);
          setCopyFailed(false);
          setCopiedKind(null);
          copyTimerRef.current = null;
        }, 1500);
      });
  }, []);

  const handleCopy = useCallback(() => {
    if (!output) {
      return;
    }

    copyText(output.text, 'transcript');
  }, [copyText, output]);

  const handleCopyError = useCallback(() => {
    if (!session.errorReport) {
      return;
    }

    copyText(session.errorReport, 'error');
  }, [copyText, session.errorReport]);

  const handleRerun = useCallback(() => {
    setPendingAction('rerun');
    void client
      .rerunSession(session.id)
      .catch((error: unknown) => {
        console.error('Toph could not rerun the session.', error);
      })
      .finally(() => {
        setPendingAction(null);
      });
  }, [client, session.id]);

  const handleDelete = useCallback(() => {
    setPendingAction('delete');
    void client.deleteSession(session.id).catch((error: unknown) => {
      console.error('Toph could not delete the session.', error);
      setPendingAction(null);
    });
  }, [client, session.id]);

  const dictationPromptText = session.dictationPromptText?.trim() ?? '';
  const hasDictationPrompt = dictationPromptText.length > 0;
  const screenshots = session.screenshots ?? [];
  const hasScreenshots = screenshots.length > 0;
  const duplicateReferenceCount = screenshots.reduce(
    (count, screenshot) => count + (screenshot.duplicateReferences?.length ?? 0),
    0,
  );
  const hasError =
    session.status === 'failed' ||
    session.status === 'recording_failed' ||
    (!output && !!session.errorMessage);
  const isPasteFailed = session.pasteStatus === 'failed';
  const isFailed = hasError || isPasteFailed;
  const title = output?.text ?? session.errorMessage ?? 'No transcript was produced.';
  const statusLabel = hasError
    ? 'Failed'
    : session.status === 'no_speech'
      ? 'No speech'
      : isPasteFailed
        ? 'Needs rerun'
        : null;

  return (
    <>
      <Collapsible.Root defaultOpen={false}>
        <article
          className={`group relative flex flex-col px-5 py-4 transition-colors duration-200 ease-out hover:bg-white/4 ${isFailed ? 'border-l-2 border-l-accent-red/50' : 'border-l-2 border-l-transparent'}`}
        >
          <Collapsible.Trigger
            className="m-0 flex w-full cursor-pointer flex-col border-0 bg-transparent p-0 text-left outline-hidden"
            render={<button type="button" />}
          >
            <div className="mb-1.5 flex items-center gap-3">
              <span className="text-sm text-text-tertiary">{relativeTime}</span>
              {statusLabel && (
                <span className="rounded-full border border-accent-red/18 bg-accent-red/12 px-2 py-0.5 text-xs font-semibold text-accent-red">
                  {statusLabel}
                </span>
              )}
            </div>

            <div className="m-0 pr-24 text-[0.95rem] leading-relaxed text-text-primary line-clamp-2 group-has-data-panel-open:line-clamp-none">
              {output ? (
                title
              ) : (
                <span className="inline-flex items-center gap-2 text-text-secondary">
                  <AlertTriangle size={15} className="text-accent-red" />
                  {title}
                </span>
              )}
            </div>

            {hasDictationPrompt && (
              <div className="mt-3 flex max-w-full items-center gap-2 text-xs text-text-tertiary">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-blue/18 bg-accent-blue/10 px-2.5 py-1 font-semibold text-accent-blue">
                  <MessageSquareText size={13} />
                  Prompt
                </span>
                <span className="min-w-0 truncate">{dictationPromptText}</span>
              </div>
            )}

            {hasScreenshots && (
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-cyan/18 bg-accent-cyan/10 px-2.5 py-1 text-xs font-semibold text-accent-cyan">
                  <ImageIcon size={13} />
                  {screenshots.length}
                </span>
                {screenshots.slice(0, 6).map((screenshot, index) => (
                  <span
                    key={screenshot.path}
                    className="relative block h-13 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-[0_8px_28px_rgba(0,0,0,0.24)]"
                  >
                    <img
                      src={toFileUrl(screenshot.path)}
                      alt={`Screenshot context ${index + 1}`}
                      className="h-full w-full object-cover opacity-90 transition-opacity duration-200 group-hover:opacity-100"
                      loading="lazy"
                    />
                    <span className="absolute right-1 bottom-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white/85">
                      {index + 1}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Collapsible.Trigger>

          <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-all duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
            <div className="space-y-3 pt-3">
              {!output && (
                <div className="rounded-2xl border border-accent-red/14 bg-accent-red/8 px-3 py-2 text-sm text-text-secondary">
                  <p className="m-0 font-medium text-accent-red">Session {session.id}</p>
                  <p className="mt-1 mb-0">
                    {session.errorMessage ??
                      'Toph kept the raw WAV, but the pipeline did not produce text.'}
                  </p>
                </div>
              )}
              {output && hasError && session.errorMessage && (
                <p className="m-0 text-xs text-accent-red">{session.errorMessage}</p>
              )}
              {output?.kind === 'polished' && output.rulePresetId && (
                <p className="mt-2 mb-0 text-xs text-text-tertiary">
                  Polished with the{' '}
                  <span className="font-semibold text-text-secondary">
                    {rulePresetTitle ?? 'selected'}
                  </span>{' '}
                  rule
                </p>
              )}

              {hasDictationPrompt && (
                <section className="rounded-xl border border-accent-blue/16 bg-accent-blue/8 px-3 py-3 text-sm text-text-secondary">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-accent-blue uppercase">
                    <MessageSquareText size={14} />
                    Dictation Prompt transcript
                  </div>
                  <p className="m-0 whitespace-pre-wrap leading-relaxed text-text-primary">
                    {dictationPromptText}
                  </p>
                  {diagnosticsEnabled && session.diagnostics && (
                    <dl className="mt-3 mb-0 grid grid-cols-[minmax(120px,auto)_1fr] gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-xs">
                      <dt className="text-text-tertiary">prompt chars</dt>
                      <dd className="m-0">{session.diagnostics.dictationPromptCharacterCount}</dd>
                      <dt className="text-text-tertiary">prompt path</dt>
                      <dd className="m-0 break-all font-mono text-[11px]">
                        {session.diagnostics.dictationPromptTextPath ?? 'n/a'}
                      </dd>
                    </dl>
                  )}
                </section>
              )}

              {hasScreenshots && (
                <div className="grid gap-3">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
                    {screenshots.map((screenshot, index) => (
                      <button
                        key={screenshot.path}
                        type="button"
                        className="group/thumb grid cursor-pointer gap-2 rounded-xl border border-white/8 bg-white/4 p-2 text-left transition-colors duration-200 hover:bg-white/7 focus:border-accent-blue/45 focus:outline-hidden"
                        aria-label={`Preview screenshot context ${index + 1}`}
                        onClick={() => setPreviewScreenshot({ screenshot, index })}
                      >
                        <span className="aspect-video overflow-hidden rounded-lg bg-black/35">
                          <img
                            src={toFileUrl(screenshot.path)}
                            alt={`Screenshot context ${index + 1}`}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover/thumb:scale-[1.03]"
                            loading="lazy"
                          />
                        </span>
                        <span className="flex items-center justify-between gap-2 text-[11px] text-text-tertiary">
                          <span>context-{String(index + 1).padStart(2, '0')}</span>
                          <span>{formatImageSize(screenshot.width, screenshot.height)}</span>
                        </span>
                      </button>
                    ))}
                  </div>

                  {diagnosticsEnabled && (
                    <details className="group/details rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-xs text-text-secondary">
                      <summary className="cursor-pointer list-none font-semibold text-text-primary marker:hidden">
                        Screenshot diagnostics
                        <span className="ml-2 text-text-tertiary group-open/details:hidden">
                          show details
                        </span>
                        <span className="ml-2 hidden text-text-tertiary group-open/details:inline">
                          hide details
                        </span>
                      </summary>
                      <div className="mt-3 grid gap-3">
                        {session.diagnostics && (
                          <dl className="m-0 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1">
                            <dt className="text-text-tertiary">session</dt>
                            <dd className="m-0 break-all font-mono text-[11px]">
                              {session.diagnostics.sessionId}
                            </dd>
                            <dt className="text-text-tertiary">output</dt>
                            <dd className="m-0 break-all font-mono text-[11px]">
                              {session.diagnostics.outputId ?? 'n/a'}
                            </dd>
                            <dt className="text-text-tertiary">output kind</dt>
                            <dd className="m-0">{session.diagnostics.outputKind ?? 'n/a'}</dd>
                            <dt className="text-text-tertiary">started</dt>
                            <dd className="m-0">
                              {formatAbsoluteTime(session.diagnostics.sessionStartedAt)}
                            </dd>
                            <dt className="text-text-tertiary">ended</dt>
                            <dd className="m-0">
                              {formatAbsoluteTime(session.diagnostics.sessionEndedAt)}
                            </dd>
                            <dt className="text-text-tertiary">duration</dt>
                            <dd className="m-0">
                              {formatDuration(session.diagnostics.sessionDurationMs)}
                            </dd>
                            <dt className="text-text-tertiary">prompt chars</dt>
                            <dd className="m-0">
                              {session.diagnostics.dictationPromptCharacterCount}
                            </dd>
                            <dt className="text-text-tertiary">prompt path</dt>
                            <dd className="m-0 break-all font-mono text-[11px]">
                              {session.diagnostics.dictationPromptTextPath ?? 'n/a'}
                            </dd>
                            <dt className="text-text-tertiary">screenshot count</dt>
                            <dd className="m-0">{session.diagnostics.screenshotCount}</dd>
                            <dt className="text-text-tertiary">similar skips</dt>
                            <dd className="m-0">{duplicateReferenceCount}</dd>
                            <dt className="text-text-tertiary">directory</dt>
                            <dd className="m-0 break-all font-mono text-[11px]">
                              {session.diagnostics.screenshotDirectory ?? 'n/a'}
                            </dd>
                          </dl>
                        )}

                        <div className="grid gap-2">
                          {screenshots.map((screenshot, index) => (
                            <dl
                              key={screenshot.path}
                              className="m-0 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 border-t border-white/8 pt-2 first:border-t-0 first:pt-0"
                            >
                              <dt className="text-text-tertiary">image {index + 1}</dt>
                              <dd className="m-0 break-all font-mono text-[11px]">
                                {screenshot.path}
                              </dd>
                              <dt className="text-text-tertiary">captured</dt>
                              <dd className="m-0">{formatAbsoluteTime(screenshot.capturedAt)}</dd>
                              <dt className="text-text-tertiary">mime/detail</dt>
                              <dd className="m-0">
                                {screenshot.mimeType} / {screenshot.detail}
                              </dd>
                              <dt className="text-text-tertiary">dimensions</dt>
                              <dd className="m-0">
                                {formatImageSize(screenshot.width, screenshot.height)}
                              </dd>
                              <dt className="text-text-tertiary">file size</dt>
                              <dd className="m-0">{formatByteSize(screenshot.byteSize)}</dd>
                              {(screenshot.duplicateReferences ?? []).map(
                                (reference, referenceIndex) => (
                                  <div
                                    key={`${reference.capturedAt}-${referenceIndex}`}
                                    className="col-span-2 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 rounded-lg bg-white/4 px-2 py-1.5"
                                  >
                                    <dt className="text-text-tertiary">
                                      similar sample {referenceIndex + 1}
                                    </dt>
                                    <dd className="m-0">
                                      captured {formatAbsoluteTime(reference.capturedAt)}
                                    </dd>
                                    <dt className="text-text-tertiary">reference</dt>
                                    <dd className="m-0 break-all font-mono text-[11px]">
                                      {reference.referencePath}
                                    </dd>
                                    <dt className="text-text-tertiary">mean diff</dt>
                                    <dd className="m-0">
                                      {formatPercent(reference.meanAbsoluteDifference)}
                                    </dd>
                                    <dt className="text-text-tertiary">changed pixels</dt>
                                    <dd className="m-0">
                                      {formatPercent(reference.changedPixelRatio)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </Collapsible.Panel>

          <div className="absolute right-4 top-4 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-has-data-popup-open:opacity-100">
            {output && (
              <button
                type="button"
                className={actionButtonClass}
                onClick={handleCopy}
                title="Copy"
                aria-label="Copy transcript"
                disabled={pendingAction !== null}
              >
                {justCopied && copiedKind === 'transcript' ? (
                  copyFailed ? (
                    <X size={15} className="text-accent-red" />
                  ) : (
                    <Check size={15} className="text-accent-green" />
                  )
                ) : (
                  <Copy size={15} />
                )}
              </button>
            )}

            {session.errorReport && (
              <button
                type="button"
                className={actionButtonClass}
                onClick={handleCopyError}
                title="Copy debug report"
                aria-label="Copy debug report"
                disabled={pendingAction !== null}
              >
                {justCopied && copiedKind === 'error' ? (
                  copyFailed ? (
                    <X size={15} className="text-accent-red" />
                  ) : (
                    <Check size={15} className="text-accent-green" />
                  )
                ) : (
                  <Copy size={15} />
                )}
              </button>
            )}

            <button
              type="button"
              className={actionButtonClass}
              onClick={handleRerun}
              title="Rerun workflow"
              aria-label="Rerun workflow"
              disabled={pendingAction !== null || !session.canRetry}
            >
              <RefreshCcw
                size={15}
                className={pendingAction === 'rerun' ? 'animate-spin' : undefined}
              />
            </button>

            <button
              type="button"
              className={deleteButtonClass}
              onClick={handleDelete}
              title="Delete"
              aria-label="Delete session"
              disabled={pendingAction !== null}
            >
              {pendingAction === 'delete' ? <X size={15} /> : <Trash2 size={15} />}
            </button>
          </div>
        </article>
      </Collapsible.Root>

      {previewScreenshot && (
        <ModalShell
          eyebrow="Screenshot context"
          title={`Screenshot context ${previewScreenshot.index + 1}`}
          description={`${formatImageSize(previewScreenshot.screenshot.width, previewScreenshot.screenshot.height)} / ${formatByteSize(previewScreenshot.screenshot.byteSize)} / ${formatAbsoluteTime(previewScreenshot.screenshot.capturedAt)}`}
          size="lg"
          onClose={() => setPreviewScreenshot(null)}
        >
          <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3 bg-black/14 p-4">
            <div className="min-h-0 overflow-hidden rounded-2xl border border-white/8 bg-black/50">
              <img
                src={toFileUrl(previewScreenshot.screenshot.path)}
                alt={`Screenshot context ${previewScreenshot.index + 1} enlarged`}
                className="h-full w-full object-contain"
              />
            </div>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-xs text-text-secondary">
              <dt className="text-text-tertiary">path</dt>
              <dd className="m-0 break-all font-mono text-[11px]">
                {previewScreenshot.screenshot.path}
              </dd>
              <dt className="text-text-tertiary">captured</dt>
              <dd className="m-0">{formatAbsoluteTime(previewScreenshot.screenshot.capturedAt)}</dd>
              <dt className="text-text-tertiary">size</dt>
              <dd className="m-0">
                {formatImageSize(
                  previewScreenshot.screenshot.width,
                  previewScreenshot.screenshot.height,
                )}{' '}
                / {formatByteSize(previewScreenshot.screenshot.byteSize)}
              </dd>
            </dl>
          </div>
        </ModalShell>
      )}
    </>
  );
}
