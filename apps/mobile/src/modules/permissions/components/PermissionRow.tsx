import { Bell, Mic } from 'lucide-react-native';

import { ChecklistRow } from '../../../ui';
import { usePermission, type PermissionId } from '../state/permissions';

const copy = {
  microphone: {
    icon: Mic,
    tone: 'blue',
    title: 'Microphone',
    why: 'So I can hear you. Only while you dictate.',
  },
  notifications: {
    icon: Bell,
    tone: 'amber',
    title: 'Notifications',
    why: 'So I can say "transcript copied" if the keyboard closes early.',
  },
} as const;

/** One runtime permission as a checklist row, worded the same wherever it is asked for. */
export function PermissionRow({
  permission,
  optional = false,
  disabled = false,
}: {
  permission: PermissionId;
  optional?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const { granted, requesting, request } = usePermission(permission);
  const { icon, tone, title, why } = copy[permission];

  return (
    <ChecklistRow
      action="Allow"
      disabled={disabled}
      done={granted}
      icon={icon}
      onAction={request}
      optional={optional}
      pending={requesting}
      title={title}
      tone={tone}
      why={why}
    />
  );
}
