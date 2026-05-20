import { Collapsible } from '@base-ui/react/collapsible';
import { AlertTriangle, Check, Copy, RefreshCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DesktopApi,
  DictationSessionRecord,
  PolishRulePresetSummary,
} from '@toph/desktop-contracts';

import { useRelativeTime } from '../hooks/use-desktop-state';

const actionButtonClass =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-transparent text-text-tertiary transition-all duration-200 ease-out hover:bg-white/8 hover:text-text-primary focus:bg-white/8 focus:text-text-primary focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-45';
const deleteButtonClass =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-accent-red/12 text-accent-red transition-all duration-200 ease-out hover:bg-accent-red/18 hover:text-accent-red focus:bg-accent-red/18 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-45';

export function DictationCard({
  session,
  rulePresets,
  client,
}: {
  session: DictationSessionRecord;
  rulePresets: PolishRulePresetSummary[];
  client: DesktopApi;
}) {
  const relativeTime = useRelativeTime(session.createdAt);
  const output = session.selectedOutput;
  const rulePresetTitle = rulePresets.find((preset) => preset.id === output?.rulePresetId)?.title;
  const [justCopied, setJustCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'transcript' | 'error' | null>(null);
  const [pendingAction, setPendingAction] = useState<'rerun' | 'delete' | null>(null);
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
        console.error('Toph could not rerun the conversion.', error);
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
        </Collapsible.Trigger>

        <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-all duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
          <div className="space-y-2 pt-3">
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
              <div className="pt-3">
                <p className="mt-2 mb-0 text-xs text-text-tertiary">
                  Polished with the{' '}
                  <span className="font-semibold text-text-secondary">
                    {rulePresetTitle ?? 'selected'}
                  </span>{' '}
                  rule
                </p>
              </div>
            )}
          </div>
        </Collapsible.Panel>

        {/* Hover Action Dock */}
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
  );
}
