import type { LucideIcon } from 'lucide-react';

export type SettingsSideNavSection<TId extends string = string> = {
  id: TId;
  label: string;
  icon: LucideIcon;
};

export function SettingsSideNav<TId extends string>({
  sections,
  activeSectionId,
  onSectionSelect,
}: {
  sections: readonly SettingsSideNavSection<TId>[];
  activeSectionId: TId;
  onSectionSelect: (sectionId: TId) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-6 h-fit max-h-[calc(100vh-4rem)] self-start overflow-y-auto overscroll-contain rounded-[20px] border border-white/6 bg-canvas-elevated/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [scrollbar-width:none] max-[820px]:static max-[820px]:mb-7 max-[820px]:max-h-none max-[820px]:overflow-x-auto max-[820px]:overflow-y-visible [&::-webkit-scrollbar]:hidden"
    >
      <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-bold tracking-[0.12em] text-text-tertiary uppercase max-[820px]:sr-only">
        Sections
      </div>
      <div className="grid gap-0.5 max-[820px]:flex max-[820px]:gap-1">
        {sections.map((section) => {
          const Icon = section.icon;
          const active = section.id === activeSectionId;

          return (
            <button
              key={section.id}
              type="button"
              aria-current={active ? 'location' : undefined}
              className={`grid w-full cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2.5 rounded-[13px] px-2.5 py-2 text-left text-[13px] font-bold transition-[background-color,color,box-shadow] duration-200 ease-out hover:bg-white/6 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue max-[820px]:w-auto max-[820px]:shrink-0 max-[820px]:grid-cols-[1.5rem_auto] ${active ? 'bg-accent-blue/12 text-text-primary shadow-[inset_0_0_0_1px_rgba(138,173,244,0.18)]' : 'text-text-secondary'}`}
              onClick={() => onSectionSelect(section.id)}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-lg transition-colors duration-200 ease-out ${active ? 'bg-accent-blue/16 text-accent-blue' : 'bg-white/6 text-text-tertiary'}`}
              >
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="truncate">{section.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
