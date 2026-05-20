export const popupSurfaceClass =
  'rounded-xl border border-white/10 bg-canvas-elevated/98 p-1 shadow-menu backdrop-blur-[48px] backdrop-saturate-150';

export const popupAnimationClass =
  'origin-(--transform-origin) transition-[transform,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0';

export const itemIndicatorClass =
  'flex size-3 shrink-0 items-center justify-center text-accent-cyan';

export const itemClass =
  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-[7px] text-[0.8125rem] text-text-primary outline-hidden select-none transition-colors duration-100 data-highlighted:bg-white/8';

export const dangerItemClass = `${itemClass} text-accent-red data-highlighted:text-accent-red`;

export const separatorClass = 'mx-1.5 my-[3px] h-px bg-white/6';

export const footerActionClass =
  'flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[0.8125rem] font-semibold text-text-secondary outline-hidden transition-colors duration-100 hover:bg-white/8 hover:text-text-primary disabled:opacity-55';

export const selectTriggerInlineClass =
  'inline-flex min-w-0 items-center justify-end gap-2 rounded-lg bg-transparent px-0 py-0 text-right text-sm font-semibold text-text-secondary transition-colors duration-150 hover:text-text-primary data-popup-open:text-text-primary disabled:opacity-55';

export const selectTriggerDefaultClass =
  'inline-flex h-11 w-full items-center rounded-lg border border-white/6 bg-canvas-elevated px-3 text-[0.8125rem] font-medium text-text-primary outline-none transition-colors duration-150 hover:border-white/12 focus:border-white/12';
