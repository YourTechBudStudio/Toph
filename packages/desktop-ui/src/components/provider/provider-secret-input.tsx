import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { settingsInputClass } from '../settings/settings-controls';

/**
 * A masked text input with a reveal toggle, used for every `secret` provider field: connection
 * forms here and in onboarding. `commit` matches whatever the field's group does — a connection
 * draft reports every keystroke so the submit button can react to it, a stored setting commits on
 * blur so a keystroke is not a write.
 */
export function ProviderSecretInput({
  value,
  placeholder,
  disabled,
  ariaLabel,
  commit,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  commit: 'change' | 'blur';
  onCommit: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="relative w-56 max-[640px]:w-44">
      <input
        type={revealed ? 'text' : 'password'}
        className={`${settingsInputClass} w-full pr-9 pl-3`}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (commit === 'change') {
            onCommit(event.currentTarget.value);
          }
        }}
        onBlur={() => {
          if (commit === 'blur' && draft !== value) {
            onCommit(draft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="absolute top-1/2 right-1.5 flex size-6.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-white/8 hover:text-text-secondary disabled:cursor-default disabled:opacity-55"
        aria-label={revealed ? `Hide ${ariaLabel}` : `Show ${ariaLabel}`}
        aria-pressed={revealed}
        disabled={disabled}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
      </button>
    </div>
  );
}
