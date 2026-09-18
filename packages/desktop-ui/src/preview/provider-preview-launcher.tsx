/**
 * Temporary in-app entry to the provider mock, so the preview can be reviewed inside the Electron
 * window instead of a browser tab. Deleted in phase 05 with the rest of `preview/`.
 */
export function ProviderPreviewLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="fixed right-4 bottom-4 z-50 cursor-pointer rounded-full border border-accent-violet/35 bg-accent-violet/14 px-3.5 py-2 text-xs font-semibold text-accent-violet shadow-[0_6px_18px_rgba(0,0,0,0.35)] transition-colors duration-150 hover:bg-accent-violet/22"
      onClick={onOpen}
    >
      Provider mock
    </button>
  );
}
