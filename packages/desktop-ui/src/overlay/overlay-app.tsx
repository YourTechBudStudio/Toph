import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { OVERLAY_WINDOW_GEOMETRY, type DesktopApi } from '@toph/desktop-contracts';

import { useDesktopState } from '../hooks/use-desktop-state';
import { useOverlaySounds } from '../hooks/use-overlay-sounds';

// Renderer-owned visual dimensions. The main process resizes the transparent
// Electron window around this measured pill while keeping its height stable.
const overlayRendererGeometry = {
  bottomInset: 8,
  pill: {
    idle: {
      width: 72,
      height: 8,
    },
    active: {
      minWidth: 164,
      height: 44,
    },
  },
  windowPaddingX: 16,
  content: {
    paddingX: 16,
    gap: 12,
    activitySlotSize: 20,
    cancelButtonSize: 24,
  },
} as const;

const overlayGeometryStyle = {
  '--overlay-bottom-inset': `${overlayRendererGeometry.bottomInset}px`,
  '--overlay-idle-width': `${overlayRendererGeometry.pill.idle.width}px`,
  '--overlay-idle-height': `${overlayRendererGeometry.pill.idle.height}px`,
  '--overlay-active-min-width': `${overlayRendererGeometry.pill.active.minWidth}px`,
  '--overlay-active-height': `${overlayRendererGeometry.pill.active.height}px`,
  '--overlay-content-padding-x': `${overlayRendererGeometry.content.paddingX}px`,
  '--overlay-content-gap': `${overlayRendererGeometry.content.gap}px`,
  '--overlay-activity-slot-size': `${overlayRendererGeometry.content.activitySlotSize}px`,
  '--overlay-cancel-button-size': `${overlayRendererGeometry.content.cancelButtonSize}px`,
} as CSSProperties;

const ruleSwitcherShellTransitionMs = 520;
const initialRuleSwitcherHeight = 80;

type RuleSwitcherVisibleMode = 'selecting' | 'selected' | 'disabled';
type RuleSwitcherPresentationMode = RuleSwitcherVisibleMode | 'closing' | 'idle';
type PendingRuleSelection = {
  rulePresetId: string;
  previousActiveRulePresetId: string | null;
};

function getScreenshotOverlayMessage(
  screenshots: {
    enabled: boolean;
    status: string;
    detail: string;
  } | null,
) {
  if (!screenshots?.enabled) {
    return null;
  }

  if (screenshots.status === 'capturing') {
    return 'Capturing screenshot...';
  }

  if (screenshots.detail.startsWith('Screenshot captured')) {
    return screenshots.detail;
  }

  if (screenshots.detail.startsWith('Similar screenshot skipped')) {
    return 'Similar screenshot skipped';
  }

  if (screenshots.detail.startsWith('Screenshot limit reached')) {
    return 'Screenshot limit reached';
  }

  if (screenshots.status === 'permission-needed' || screenshots.status === 'error') {
    return 'Screenshot capture failed';
  }

  return null;
}

function getDictationPromptOverlayMessage(
  dictationPrompt: {
    enabled: boolean;
    status: string;
    detail: string;
  } | null,
) {
  if (!dictationPrompt?.enabled) {
    return null;
  }

  if (dictationPrompt.status === 'capturing') {
    return 'Dictation prompt...';
  }

  if (dictationPrompt.status === 'captured') {
    return 'Dictation prompt saved';
  }

  if (dictationPrompt.status === 'error') {
    return 'Dictation prompt failed';
  }

  return null;
}

function resolveRuleSwitcherWidth(ruleCount: number, mode: 'idle' | RuleSwitcherVisibleMode) {
  // Do not use viewport units here: the viewport is the current Electron overlay
  // window, so vw-based sizing can trap the selector at the old pill width.
  if (mode === 'selected') {
    return 420;
  }

  if (mode === 'disabled') {
    return 440;
  }

  const selectorWidth = ruleCount <= 1 ? 300 : ruleCount <= 2 ? 500 : ruleCount <= 4 ? 720 : 840;
  return selectorWidth;
}

export function OverlayApp({
  client,
  soundsEnabled = true,
}: {
  client: DesktopApi;
  soundsEnabled?: boolean;
}) {
  const pillRef = useRef<HTMLElement>(null);
  const ruleSwitcherContentRef = useRef<HTMLDivElement>(null);
  const lastRuleSwitcherWidthRef = useRef(440);
  const lastRuleSwitcherHeightRef = useRef(initialRuleSwitcherHeight);
  const lastVisibleRuleSwitcherModeRef = useRef<RuleSwitcherVisibleMode>('selecting');
  const [ruleSwitcherPresentationMode, setRuleSwitcherPresentationMode] =
    useState<RuleSwitcherPresentationMode>('idle');
  const [ruleSwitcherHeight, setRuleSwitcherHeight] = useState(initialRuleSwitcherHeight);
  const [pendingRuleSelection, setPendingRuleSelection] = useState<PendingRuleSelection | null>(
    null,
  );
  const state = useDesktopState(client);
  useOverlaySounds(client, soundsEnabled);

  const phase = state?.phase || 'idle';
  const ruleSwitcherMode = state?.ruleSwitcher.mode ?? 'idle';
  const isIdle = phase === 'idle';
  const ruleSwitcherVisible = ruleSwitcherPresentationMode !== 'idle';
  const ruleSwitcherClosing = ruleSwitcherPresentationMode === 'closing';
  const ruleSwitcherExpanded = ruleSwitcherVisible && !ruleSwitcherClosing;
  const ruleSwitcherSelecting = ruleSwitcherMode === 'selecting';
  const listening = phase === 'listening';
  const polishing = phase === 'polishing';
  const noSpeech = phase === 'no_speech';
  const failed = phase === 'failed';
  const screenshotOverlayMessage = listening
    ? getScreenshotOverlayMessage(state?.context.screenshots ?? null)
    : null;
  const dictationPromptOverlayMessage = listening
    ? getDictationPromptOverlayMessage(state?.context.dictationPrompt ?? null)
    : null;
  const activeRulePresetId = state?.settings.polish.rulePresetId ?? null;
  const renderedActiveRulePresetId = pendingRuleSelection
    ? pendingRuleSelection.previousActiveRulePresetId
    : activeRulePresetId;
  const rulePresets = state?.polish.rulePresets ?? [];
  const liveRuleSwitcherWidth = resolveRuleSwitcherWidth(rulePresets.length, ruleSwitcherMode);
  if (ruleSwitcherMode !== 'idle') {
    lastRuleSwitcherWidthRef.current = liveRuleSwitcherWidth;
    lastVisibleRuleSwitcherModeRef.current = ruleSwitcherMode;
  }
  const ruleSwitcherWidth =
    ruleSwitcherMode === 'idle' && ruleSwitcherPresentationMode !== 'idle'
      ? lastRuleSwitcherWidthRef.current
      : liveRuleSwitcherWidth;
  const renderedRuleSwitcherContentMode: RuleSwitcherVisibleMode = ruleSwitcherClosing
    ? lastVisibleRuleSwitcherModeRef.current
    : ruleSwitcherPresentationMode === 'idle'
      ? 'selecting'
      : ruleSwitcherPresentationMode;
  const animateRuleSwitcherContentEnter =
    !ruleSwitcherClosing && renderedRuleSwitcherContentMode === 'selecting';
  const pillVisualClass = failed
    ? 'h-(--overlay-active-height) min-w-(--overlay-active-min-width) rounded-full border-accent-red/36 bg-[rgba(63,32,45,0.96)] shadow-[0_8px_24px_rgba(0,0,0,0.3)]'
    : ruleSwitcherExpanded
      ? 'h-(--rule-switcher-height) w-(--rule-switcher-width) rounded-[28px] border-white/8 bg-canvas/98 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
      : isIdle
        ? 'h-(--overlay-idle-height) w-(--overlay-idle-width) rounded-full border-white/8 bg-canvas shadow-[0_4px_12px_rgba(0,0,0,0.2)]'
        : 'h-(--overlay-active-height) min-w-(--overlay-active-min-width) rounded-full border-white/8 bg-canvas/95 shadow-[0_8px_24px_rgba(0,0,0,0.3)]';

  useEffect(() => {
    if (ruleSwitcherMode !== 'idle') {
      setRuleSwitcherPresentationMode(ruleSwitcherMode);
      return;
    }

    setRuleSwitcherPresentationMode((current) => {
      if (current === 'idle') {
        return 'idle';
      }

      return 'closing';
    });
  }, [ruleSwitcherMode]);

  useEffect(() => {
    if (ruleSwitcherMode !== 'idle') {
      return;
    }

    setPendingRuleSelection(null);
  }, [ruleSwitcherMode]);

  useEffect(() => {
    if (ruleSwitcherPresentationMode !== 'closing') {
      return;
    }

    const timer = setTimeout(() => {
      setRuleSwitcherPresentationMode((current) => (current === 'closing' ? 'idle' : current));
    }, ruleSwitcherShellTransitionMs);
    return () => {
      clearTimeout(timer);
    };
  }, [ruleSwitcherPresentationMode]);

  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) {
      return;
    }

    let lastWidth = 0;
    let lastHeight = 0;
    const resizeOverlay = () => {
      const bounds = pill.getBoundingClientRect();
      const ruleSwitcherContent = ruleSwitcherContentRef.current;
      if (ruleSwitcherExpanded && ruleSwitcherContent) {
        const nextRuleSwitcherHeight = Math.ceil(ruleSwitcherContent.scrollHeight);
        lastRuleSwitcherHeightRef.current = nextRuleSwitcherHeight;
        setRuleSwitcherHeight((current) =>
          current === nextRuleSwitcherHeight ? current : nextRuleSwitcherHeight,
        );
      }

      const width = Math.ceil(bounds.width + overlayRendererGeometry.windowPaddingX * 2);
      const height = ruleSwitcherVisible
        ? Math.ceil(bounds.height + overlayRendererGeometry.bottomInset + 16)
        : OVERLAY_WINDOW_GEOMETRY.height;
      if (width === lastWidth && height === lastHeight) {
        return;
      }

      lastWidth = width;
      lastHeight = height;
      void client.resizeOverlay({ width, height }).catch((error: unknown) => {
        console.error('Toph could not resize the overlay window.', error);
      });
    };

    resizeOverlay();
    const observer = new ResizeObserver(resizeOverlay);
    observer.observe(pill);
    return () => {
      observer.disconnect();
    };
  }, [
    client,
    phase,
    ruleSwitcherVisible,
    ruleSwitcherExpanded,
    rulePresets.length,
    ruleSwitcherPresentationMode,
    ruleSwitcherWidth,
  ]);

  const cancelCapture = () => {
    void client.cancelCapture().catch((error: unknown) => {
      console.error('Toph could not cancel dictation.', error);
    });
  };

  const selectRulePreset = (rulePresetId: string) => {
    setPendingRuleSelection((current) => ({
      rulePresetId,
      previousActiveRulePresetId: current?.previousActiveRulePresetId ?? activeRulePresetId,
    }));
    void client.selectRuleSwitcherPreset(rulePresetId).catch((error: unknown) => {
      setPendingRuleSelection(null);
      console.error('Toph could not switch writing rules.', error);
    });
  };

  useEffect(() => {
    if (!ruleSwitcherSelecting) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void client.closeRuleSwitcher();
        return;
      }

      if (!/^[1-9]$/.test(event.key)) {
        return;
      }

      const rulePreset = rulePresets[Number(event.key) - 1];
      if (!rulePreset) {
        return;
      }

      event.preventDefault();
      selectRulePreset(rulePreset.id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [client, rulePresets, ruleSwitcherSelecting, selectRulePreset]);

  return (
    <main
      className="flex h-screen w-screen flex-col items-center justify-end pb-(--overlay-bottom-inset)"
      style={
        {
          ...overlayGeometryStyle,
          '--rule-switcher-width': `${ruleSwitcherWidth}px`,
          '--rule-switcher-height': `${ruleSwitcherClosing ? lastRuleSwitcherHeightRef.current : ruleSwitcherHeight}px`,
        } as CSSProperties
      }
      aria-label={isIdle && !ruleSwitcherVisible ? 'Toph ready' : 'Toph active'}
    >
      {/* The Electron overlay window sits flush to the screen bottom; keep the
      visible pill bottom-anchored so active growth expands upward. */}
      <section
        ref={pillRef}
        className={`flex items-center justify-center overflow-hidden border backdrop-blur-xl transition-all duration-520 ease-[cubic-bezier(0.16,1,0.3,1)] ${pillVisualClass}`}
        aria-hidden={isIdle && !ruleSwitcherVisible}
      >
        {ruleSwitcherVisible ? (
          <div
            ref={ruleSwitcherContentRef}
            key={renderedRuleSwitcherContentMode}
            className={`${animateRuleSwitcherContentEnter ? 'animate-rule-switcher-content-enter [animation-delay:120ms]' : ''} transition-[opacity,transform] duration-150 ease-out ${ruleSwitcherClosing ? 'opacity-0 translate-y-1 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'}`}
          >
            <RuleSwitcherContent
              mode={renderedRuleSwitcherContentMode}
              rulePresets={rulePresets}
              activeRulePresetId={renderedActiveRulePresetId}
              pendingRulePresetId={pendingRuleSelection?.rulePresetId ?? null}
              selectedRulePresetId={state?.ruleSwitcher.selectedRulePresetId ?? null}
              message={state?.ruleSwitcher.message ?? null}
              onSelect={selectRulePreset}
            />
          </div>
        ) : (
          <div
            className={`flex h-full items-center gap-(--overlay-content-gap) px-(--overlay-content-padding-x) transition-[opacity,visibility] duration-200 ease-out ${isIdle ? 'invisible opacity-0 delay-0' : 'visible opacity-100 delay-150'}`}
          >
            <div className="flex size-(--overlay-activity-slot-size) shrink-0 items-center justify-center">
              {failed ? (
                <span className="size-3.5 rounded-full bg-accent-red" />
              ) : noSpeech ? (
                <span className="size-3.5 rounded-full bg-accent-amber" />
              ) : listening ? (
                <div className="flex h-3.5 items-center gap-0.75" aria-hidden="true">
                  <span className="h-2 w-1 animate-wave rounded-full bg-text-primary" />
                  <span className="h-3 w-1 animate-wave rounded-full bg-text-primary [animation-delay:0.12s]" />
                  <span className="h-3.5 w-1 animate-wave rounded-full bg-text-primary [animation-delay:0.24s]" />
                  <span className="h-2.5 w-1 animate-wave rounded-full bg-text-primary [animation-delay:0.36s]" />
                </div>
              ) : (
                <span className="size-4 animate-spin-ring rounded-full border-2 border-text-tertiary/20 border-t-text-primary" />
              )}
            </div>

            <h2 className="m-0 text-left text-[0.92rem] font-medium tracking-tight whitespace-nowrap text-text-primary">
              {failed
                ? 'Failed'
                : noSpeech
                  ? 'No speech detected'
                  : listening
                    ? (dictationPromptOverlayMessage ?? screenshotOverlayMessage ?? 'Listening...')
                    : polishing
                      ? 'Polishing...'
                      : 'Transcribing...'}
            </h2>

            {!isIdle ? (
              <button
                type="button"
                className="flex size-(--overlay-cancel-button-size) shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/6 text-[1.05rem] leading-none text-text-secondary transition-[background-color,color,transform] duration-200 ease-out hover:scale-105 hover:bg-accent-red/18 hover:text-accent-red active:scale-95"
                aria-label="Cancel dictation"
                onClick={cancelCapture}
              >
                &#215;
              </button>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}

function RuleSwitcherContent({
  mode,
  rulePresets,
  activeRulePresetId,
  pendingRulePresetId,
  selectedRulePresetId,
  message,
  onSelect,
}: {
  mode: 'selecting' | 'selected' | 'disabled';
  rulePresets: Array<{ id: string; title: string; description: string }>;
  activeRulePresetId: string | null;
  pendingRulePresetId: string | null;
  selectedRulePresetId: string | null;
  message: string | null;
  onSelect: (rulePresetId: string) => void;
}) {
  if (mode === 'disabled') {
    return (
      <div className="grid w-(--rule-switcher-width) gap-1 px-5 py-4 text-center">
        <h2 className="m-0 font-display text-base font-semibold tracking-[-0.02em] text-accent-amber">
          Polishing is disabled
        </h2>
        <p className="m-0 text-sm text-text-secondary">
          {message ?? "Can't switch rules while the prose engine is unplugged."}
        </p>
        <p className="m-0 text-xs text-text-tertiary">
          Enable polishing in Settings to wake it back up.
        </p>
      </div>
    );
  }

  if (mode === 'selected') {
    const selected = rulePresets.find((preset) => preset.id === selectedRulePresetId);
    return (
      <div className="flex w-(--rule-switcher-width) items-center justify-center gap-3 px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-full bg-accent-green/14 text-accent-green">
          ✓
        </span>
        <div className="text-left">
          <h2 className="m-0 font-display text-base font-semibold tracking-[-0.02em] text-text-primary">
            {message ?? `${selected?.title ?? 'Rule'} selected`}
          </h2>
          <p className="m-0 text-sm text-text-tertiary">
            Linting your sentences with unreasonable confidence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-(--rule-switcher-width) px-5 py-4">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="m-0 font-display text-base font-semibold tracking-[-0.02em] text-text-primary">
            Choose writing rule
          </h2>
          <p className="m-0 text-xs text-text-tertiary">
            Press 1-{rulePresets.length} or click a card.
          </p>
        </div>
        <span className="rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-text-tertiary">
          Esc closes
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11.5rem,1fr))] gap-2.5">
        {rulePresets.map((rulePreset, index) => {
          const active = rulePreset.id === activeRulePresetId;
          const pending = rulePreset.id === pendingRulePresetId;
          return (
            <button
              key={rulePreset.id}
              type="button"
              className={`grid min-h-24 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-2xl border p-3 text-left transition-[transform,background-color,border-color] duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98] ${pending ? 'border-accent-blue/45 bg-accent-blue/12' : active ? 'border-accent-green/45 bg-accent-green/12' : 'border-white/7 bg-white/5 hover:border-accent-blue/35 hover:bg-accent-blue/10'}`}
              onClick={() => onSelect(rulePreset.id)}
            >
              <span
                className={`flex size-7 items-center justify-center rounded-xl border font-display text-sm font-bold transition-[background-color,border-color,color] duration-200 ease-out ${pending ? 'border-accent-blue/35 bg-accent-blue/14 text-accent-blue' : 'border-white/10 bg-canvas-subtle text-text-primary'}`}
              >
                {pending ? '✓' : index + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-text-primary">
                    {rulePreset.title}
                  </span>
                  {pending && <span className="shrink-0 text-xs text-accent-blue">Selected</span>}
                  {active && !pending && (
                    <span className="shrink-0 text-xs text-accent-green">Active</span>
                  )}
                </span>
                <span className="mt-1 block overflow-hidden text-xs leading-snug text-text-tertiary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                  {rulePreset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
