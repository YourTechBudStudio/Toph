import { Keyboard } from 'lucide-react-native';

import { ChecklistRow } from '../../../ui';
import { useKeyboardStore } from '../state/keyboard';

/** Turning on Toph Voice in Android's keyboard settings, as a checklist row. */
export function KeyboardRow({ disabled = false }: { disabled?: boolean | undefined }) {
  const enabled = useKeyboardStore((state) => state.enabled);
  const enabling = useKeyboardStore((state) => state.enabling);
  const enable = useKeyboardStore((state) => state.enable);

  return (
    <ChecklistRow
      action="Turn on"
      disabled={disabled}
      done={enabled}
      icon={Keyboard}
      onAction={enable}
      pending={enabling}
      title="Toph Voice"
      tone="violet"
      why="The keyboard that dictates into any app."
    />
  );
}
