import { Keyboard } from 'lucide-react-native';

import { ChecklistRow } from '../../../ui';
import { openKeyboardSettings, useKeyboardEnabled } from '../state/keyboard';

/** Turning on Toph Voice in Android's keyboard settings, as a checklist row. */
export function KeyboardRow({ disabled = false }: { disabled?: boolean | undefined }) {
  const enabled = useKeyboardEnabled();

  return (
    <ChecklistRow
      action="Turn on"
      disabled={disabled}
      done={enabled}
      icon={Keyboard}
      onAction={openKeyboardSettings}
      pending={false}
      title="Toph Voice"
      tone="violet"
      why="The keyboard that dictates into any app."
    />
  );
}
