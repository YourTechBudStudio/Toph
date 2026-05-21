import { useRef, type PointerEvent, type ReactNode } from 'react';

import type { DesktopApi, WindowBounds } from '@toph/desktop-contracts';

type DragState = {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  bounds: WindowBounds | null;
};

function WindowControlIcon({ kind }: { kind: 'minimize' | 'maximize' | 'close' }) {
  if (kind === 'minimize') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path d="M2.25 6h7.5" />
      </svg>
    );
  }

  if (kind === 'maximize') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <rect x="2.75" y="2.75" width="6.5" height="6.5" rx="1" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="size-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M3 3l6 6M9 3L3 9" />
    </svg>
  );
}

function ChromeButton({
  label,
  kind,
  onClick,
}: {
  label: string;
  kind: 'minimize' | 'maximize' | 'close';
  onClick: () => void;
}) {
  const tone =
    kind === 'close' ? 'text-accent-red/85 hover:bg-accent-red/12' : 'text-text-secondary';

  return (
    <button
      type="button"
      aria-label={label}
      className={`grid size-8.5 cursor-pointer place-items-center rounded-lg transition-[background-color,color] duration-200 ease-out [-webkit-app-region:no-drag] hover:bg-white/7 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue ${tone}`}
      onClick={onClick}
    >
      <WindowControlIcon kind={kind} />
    </button>
  );
}

function LinuxWindowsChrome({ client }: { client: DesktopApi }) {
  const dragStateRef = useRef<DragState | null>(null);

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const startDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }

    const dragState: DragState = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      bounds: null,
    };

    dragStateRef.current = dragState;
    event.currentTarget.setPointerCapture(event.pointerId);
    void client
      .getSettingsWindowBounds()
      .then((bounds) => {
        if (dragStateRef.current === dragState) {
          dragState.bounds = bounds;
        }
      })
      .catch(() => {
        if (dragStateRef.current === dragState) {
          dragStateRef.current = null;
        }
      });
  };

  const moveWindow = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !dragState.bounds) {
      return;
    }

    void client
      .moveSettingsWindow({
        x: dragState.bounds.x + event.screenX - dragState.startScreenX,
        y: dragState.bounds.y + event.screenY - dragState.startScreenY,
      })
      .catch(() => {
        dragStateRef.current = null;
      });
  };

  return (
    <div
      aria-label="Window drag region"
      className="fixed top-0 right-0 left-0 z-50 flex h-10 touch-none items-center justify-end bg-linear-to-b from-white/[0.035] to-transparent px-3 select-none"
      onDoubleClick={() => void client.toggleSettingsMaximized()}
      onPointerCancel={stopDragging}
      onPointerDown={startDragging}
      onPointerMove={moveWindow}
      onPointerUp={stopDragging}
    >
      <div
        className="flex items-center gap-0.5"
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ChromeButton
          label="Minimize window"
          kind="minimize"
          onClick={() => void client.minimizeSettings()}
        />
        <ChromeButton
          label="Maximize or restore window"
          kind="maximize"
          onClick={() => void client.toggleSettingsMaximized()}
        />
        <ChromeButton
          label="Close window"
          kind="close"
          onClick={() => void client.hideSettings()}
        />
      </div>
    </div>
  );
}

export function MainWindowChrome({
  platform,
  client,
  children,
}: {
  platform: NodeJS.Platform;
  client: DesktopApi;
  children: ReactNode;
}) {
  const showCustomControls = platform === 'linux' || platform === 'win32';

  return (
    <>
      {platform === 'darwin' && (
        <div className="fixed top-0 right-0 left-0 z-50 h-10 [-webkit-app-region:drag]" />
      )}
      {showCustomControls && <LinuxWindowsChrome client={client} />}
      {children}
    </>
  );
}
