import { Select } from '@base-ui/react/select';

import {
  footerActionClass,
  itemClass,
  itemIndicatorClass,
  popupAnimationClass,
  popupSurfaceClass,
  separatorClass,
  selectTriggerDefaultClass,
  selectTriggerInlineClass,
} from './dropdown-styles';

export type DropdownSelectItem<TValue extends string = string> = {
  value: TValue;
  label: string;
};

export type DropdownSelectFooterAction = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export type DropdownSelectVariant = 'inline' | 'default';

export function DropdownSelect<TValue extends string>({
  ariaLabel,
  items,
  value,
  placeholder,
  disabled,
  footerAction,
  variant = 'inline',
  onValueChange,
}: {
  ariaLabel: string;
  items: DropdownSelectItem<TValue>[];
  value: TValue;
  placeholder: string;
  disabled?: boolean;
  footerAction?: DropdownSelectFooterAction;
  variant?: DropdownSelectVariant;
  onValueChange: (value: TValue) => void;
}) {
  const triggerClass = variant === 'inline' ? selectTriggerInlineClass : selectTriggerDefaultClass;

  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(nextValue) => nextValue != null && onValueChange(nextValue as TValue)}
    >
      <Select.Trigger aria-label={ariaLabel} className={triggerClass} disabled={disabled}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="text-text-tertiary">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 2L7 5L3 8" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="outline-hidden" sideOffset={6} alignItemWithTrigger={false}>
          <Select.Popup className={`${popupSurfaceClass} ${popupAnimationClass}`}>
            <Select.List>
              {items.map((item) => (
                <Select.Item key={item.value} value={item.value} className={itemClass}>
                  <span className={itemIndicatorClass}>
                    <Select.ItemIndicator>
                      <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M9.16 1.12a.75.75 0 0 1 .22 1.04L5.14 8.66a.75.75 0 0 1-1.13.13L1.25 6.31a.75.75 0 1 1 1.06-1.06l2.1 1.91L8.12 1.34a.75.75 0 0 1 1.04-.22Z" />
                      </svg>
                    </Select.ItemIndicator>
                  </span>
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
            {footerAction && (
              <>
                <div className={separatorClass} />
                <button
                  type="button"
                  className={footerActionClass}
                  disabled={footerAction.disabled}
                  onClick={footerAction.onClick}
                >
                  <svg
                    className="size-3 shrink-0 text-text-tertiary"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 2.75V5H7.75" />
                    <path d="M2 9.25V7h2.25" />
                    <path d="M9.06 5A3.5 3.5 0 0 0 3.3 3.68L2 5" />
                    <path d="M2.94 7a3.5 3.5 0 0 0 5.76 1.32L10 7" />
                  </svg>
                  {footerAction.label}
                </button>
              </>
            )}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
