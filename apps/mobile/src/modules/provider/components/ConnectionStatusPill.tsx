import { StatusPill, type Tone } from '../../../ui';
import { useProviderStore, type ConnectionStatus } from '../state/provider';

const presentation: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  disconnected: { label: 'Not connected', tone: 'neutral' },
  connecting: { label: 'Checking…', tone: 'blue' },
  connected: { label: 'Connected', tone: 'green' },
  invalid: { label: 'Connection failed', tone: 'red' },
};

export function ConnectionStatusPill() {
  const status = useProviderStore((state) => state.status);
  const { label, tone } = presentation[status];
  return <StatusPill label={label} live={status === 'connecting'} tone={tone} />;
}
