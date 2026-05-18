import { useEffect, useState, type ReactNode } from 'react';

import { DropdownSelect, type DropdownSelectItem } from '../dropdown';

export type SettingsSelectItem<TValue extends string = string> = DropdownSelectItem<TValue>;

export function SettingsSection({
  eyebrow,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="mb-7">
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
  layout = 'inline',
}: {
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: 'default' | 'danger';
  layout?: 'inline' | 'stacked';
}) {
  const labelClass = tone === 'danger' ? 'text-accent-red' : 'text-text-primary';
  const descriptionClass = tone === 'danger' ? 'text-accent-red' : 'text-text-secondary';
  const rowClass =
    layout === 'stacked'
      ? `flex min-h-12 flex-col items-stretch gap-3 border-b border-white/5 px-4 py-3 last:border-b-0 ${className}`
      : `flex min-h-12 items-center justify-between gap-4 border-b border-white/5 px-4 py-3 last:border-b-0 ${className}`;

  return (
    <div className={rowClass}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className={`text-sm font-semibold wrap-break-word ${labelClass}`}>{label}</div>
          {description && (
            <div className={`text-xs leading-relaxed ${descriptionClass}`}>{description}</div>
          )}
        </div>
      </div>
      {children && (
        <div
          className={
            layout === 'stacked'
              ? 'flex w-full min-w-0 flex-col items-stretch gap-2'
              : 'flex min-w-0 shrink-0 items-center gap-2'
          }
        >
          {children}
        </div>
      )}
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

export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
  inactiveTone = 'muted',
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  inactiveTone?: 'muted' | 'amber' | 'red';
}) {
  const inactiveClass = {
    muted: 'bg-white/6 text-text-tertiary',
    amber: 'bg-accent-amber/12 text-accent-amber',
    red: 'bg-accent-red/12 text-accent-red',
  }[inactiveTone];
  const inactiveDotClass = {
    muted: 'bg-text-tertiary',
    amber: 'bg-accent-amber',
    red: 'bg-accent-red',
  }[inactiveTone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-accent-green/12 text-accent-green' : inactiveClass}`}
    >
      <span className={`size-1.5 rounded-full ${active ? 'bg-accent-green' : inactiveDotClass}`} />
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
  onValueChange,
}: {
  items: SettingsSelectItem<TValue>[];
  value: TValue;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <DropdownSelect
      ariaLabel={placeholder}
      items={items}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      variant="inline"
      onValueChange={onValueChange}
    />
  );
}

export function SettingsTextInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="w-40 rounded-lg border border-white/8 bg-white/4 px-3 py-1.5 text-right text-sm font-semibold text-text-primary outline-hidden transition-colors duration-150 hover:bg-white/6 focus:border-accent-blue/70 focus:bg-white/6 disabled:opacity-55"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
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
      className="w-24 rounded-lg border border-white/8 bg-white/4 px-3 py-1.5 text-right text-sm font-semibold text-text-primary outline-hidden transition-colors duration-150 hover:bg-white/6 focus:border-accent-blue/70 focus:bg-white/6 disabled:opacity-55"
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
