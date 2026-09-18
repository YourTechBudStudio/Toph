import { useEffect, useState, type ReactNode } from 'react';

import {
  DropdownSelect,
  type DropdownSelectFooterAction,
  type DropdownSelectItem,
} from '../dropdown';

export type SettingsSelectItem<TValue extends string = string> = DropdownSelectItem<TValue>;

/**
 * The border, surface and focus treatment every settings input shares. Callers add width and
 * alignment; they never restate the visual state classes, so a focus-ring or disabled change lands
 * in one place.
 */
export const settingsInputClass =
  'rounded-lg border border-white/8 bg-white/4 py-1.5 text-sm font-semibold text-text-primary outline-hidden transition-colors duration-150 hover:bg-white/6 focus:border-accent-blue/70 focus:bg-white/6 disabled:opacity-55';

export function SettingsSection({
  id,
  eyebrow,
  description,
  children,
  footer,
}: {
  id?: string;
  eyebrow: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section id={id} className="mb-7 scroll-mt-12">
      <span className="mb-2 inline-flex px-1 text-xs font-bold tracking-[0.12em] text-accent-cyan uppercase">
        {eyebrow}
      </span>
      {description && (
        <p className="mb-2 px-1 text-sm leading-relaxed text-text-secondary">{description}</p>
      )}
      <div className="overflow-hidden rounded-xl border border-white/6 bg-canvas-elevated/55">
        {children}
      </div>
      {footer && (
        <div className="px-1 pt-2 text-xs leading-relaxed text-text-tertiary">{footer}</div>
      )}
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  icon,
  children,
  className = '',
  tone = 'default',
}: {
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: 'default' | 'danger';
}) {
  const labelClass = tone === 'danger' ? 'text-accent-red' : 'text-text-primary';
  const descriptionClass = tone === 'danger' ? 'text-accent-red' : 'text-text-secondary';

  return (
    <div
      className={`flex min-h-12 items-center justify-between gap-4 border-b border-white/5 px-4 py-3 last:border-b-0 ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${labelClass}`}>{label}</div>
          {description && (
            <div className={`text-xs leading-relaxed ${descriptionClass}`}>{description}</div>
          )}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function SettingsIcon({
  tone,
  children,
}: {
  tone: 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'cyan';
  children: ReactNode;
}) {
  const toneClass = {
    blue: 'bg-accent-blue/14 text-accent-blue',
    violet: 'bg-accent-violet/14 text-accent-violet',
    amber: 'bg-accent-amber/14 text-accent-amber',
    green: 'bg-accent-green/14 text-accent-green',
    red: 'bg-accent-red/14 text-accent-red',
    cyan: 'bg-accent-cyan/14 text-accent-cyan',
  }[tone];

  return (
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
      {children}
    </span>
  );
}

export type BadgeTone = 'muted' | 'green' | 'blue' | 'amber' | 'red';

/** Badge tones, shared so a status pill looks the same wherever it is built. */
export const badgeToneClass: Record<BadgeTone, string> = {
  muted: 'bg-white/6 text-text-tertiary',
  green: 'bg-accent-green/12 text-accent-green',
  blue: 'bg-accent-blue/12 text-accent-blue',
  amber: 'bg-accent-amber/12 text-accent-amber',
  red: 'bg-accent-red/12 text-accent-red',
};

export const badgeDotClass: Record<BadgeTone, string> = {
  muted: 'bg-text-tertiary',
  green: 'bg-accent-green',
  blue: 'bg-accent-blue',
  amber: 'bg-accent-amber',
  red: 'bg-accent-red',
};

export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
  inactiveTone = 'muted',
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  inactiveTone?: Extract<BadgeTone, 'muted' | 'amber' | 'red'>;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? badgeToneClass.green : badgeToneClass[inactiveTone]}`}
    >
      <span
        className={`size-1.5 rounded-full ${active ? badgeDotClass.green : badgeDotClass[inactiveTone]}`}
      />
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function SettingsSwitch({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-6.5 w-11 rounded-full transition-colors duration-200 ease-out disabled:cursor-default disabled:opacity-55 ${checked ? 'bg-accent-green' : 'bg-white/12'}`}
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
    >
      <span
        className={`absolute top-0.75 left-0.75 size-5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out ${checked ? 'translate-x-[18px]' : ''}`}
      />
    </button>
  );
}

export function SettingsSelect<TValue extends string>({
  items,
  value,
  placeholder,
  disabled,
  footerAction,
  onValueChange,
}: {
  items: SettingsSelectItem<TValue>[];
  value: TValue | null;
  placeholder: string;
  disabled?: boolean;
  footerAction?: DropdownSelectFooterAction;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <DropdownSelect
      ariaLabel={placeholder}
      items={items}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      footerAction={footerAction}
      variant="inline"
      onValueChange={onValueChange}
    />
  );
}

export function SettingsTextInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <input
      className={`${settingsInputClass} w-40 px-3 text-right`}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function SettingsNumberInput({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (
      !Number.isFinite(next) ||
      (min !== undefined && next < min) ||
      (max !== undefined && next > max)
    ) {
      setDraft(String(value));
      return;
    }

    const rounded = Math.round(next);
    setDraft(String(rounded));
    if (rounded !== value) {
      onChange(rounded);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      className={`${settingsInputClass} w-24 px-3 text-right`}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
