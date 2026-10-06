import { useLocalSearchParams } from 'expo-router';

import { DictationDetailScreen } from '../../modules/history';

export default function DictationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DictationDetailScreen id={id} />;
}
