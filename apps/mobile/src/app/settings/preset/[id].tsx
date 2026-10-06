import { useLocalSearchParams } from 'expo-router';

import { PresetScreen } from '../../../modules/polish';

export default function PresetRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PresetScreen id={id} />;
}
