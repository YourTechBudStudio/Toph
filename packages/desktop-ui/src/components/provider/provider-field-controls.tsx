import type { ProviderFieldSpec, ProviderFieldValue } from '@toph/desktop-contracts';

import {
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
  SettingsTextInput,
  settingsInputClass,
} from '../settings/settings-controls';
import { ProviderSecretInput } from './provider-secret-input';

/**
 * How a declared field is being edited.
 *
 * `setting` is a persisted value: text commits on blur, because every commit is a write.
 * `form` is an unsubmitted connection draft: text reports every keystroke, because the Connect
 * button is gated on what is currently typed.
 */
export type ProviderFieldMode = 'setting' | 'form';

/**
 * The single renderer for one declared provider field (D3). Every provider settings field and every
 * connection form field in the app goes through here, so no surface needs per-provider JSX.
 */
export function ProviderFieldControl({
  field,
  value,
  mode = 'setting',
  disabled,
  onChange,
}: {
  field: ProviderFieldSpec;
  value: ProviderFieldValue;
  mode?: ProviderFieldMode;
  disabled?: boolean;
  onChange: (value: ProviderFieldValue) => void;
}) {
  return (
    <SettingsRow label={field.label} description={field.description}>
      {renderControl()}
    </SettingsRow>
  );

  function renderControl() {
    if (field.kind === 'toggle') {
      return (
        <SettingsSwitch
          checked={typeof value === 'boolean' ? value : field.default}
          disabled={disabled}
          label={field.label}
          onCheckedChange={onChange}
        />
      );
    }

    if (field.kind === 'select') {
      return (
        <SettingsSelect
          items={field.options.map((option) => ({ value: option.value, label: option.label }))}
          value={typeof value === 'string' ? value : field.default}
          placeholder={field.label}
          disabled={disabled}
          onValueChange={onChange}
        />
      );
    }

    const text = typeof value === 'string' ? value : field.default;

    // The mode decides the commit policy for every text field, masked or not: a secret declared as
    // a stored setting must not write on each keystroke just because it is secret.
    if (field.secret === true) {
      return (
        <ProviderSecretInput
          value={text}
          placeholder={field.placeholder}
          disabled={disabled}
          ariaLabel={field.label}
          commit={mode === 'form' ? 'change' : 'blur'}
          onCommit={onChange}
        />
      );
    }

    if (mode === 'form') {
      return (
        <input
          className={`${settingsInputClass} w-56 px-3 max-[640px]:w-44`}
          value={text}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-label={field.label}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    }

    return (
      <SettingsTextInput
        value={text}
        disabled={disabled}
        ariaLabel={field.label}
        onCommit={onChange}
      />
    );
  }
}
