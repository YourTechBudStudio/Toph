import { View } from 'react-native';

import { usePolishStore } from '../state/polish';
import { ErrorLine } from './ErrorLine';
import { PresetCard } from './PresetCard';

/**
 * The writing styles as choosable cards. Settings lets you edit their rules; onboarding only asks
 * you to pick one. When polish storage is unusable it shows why instead of an empty list.
 */
export function PresetPicker({
  editable,
  disabled = false,
}: {
  editable: boolean;
  disabled?: boolean | undefined;
}) {
  const presets = usePolishStore((state) => state.presets);
  const activePresetId = usePolishStore((state) => state.activePresetId);
  const setActivePreset = usePolishStore((state) => state.setActivePreset);
  const storageError = usePolishStore((state) => state.storageError);

  if (storageError !== null) {
    return <ErrorLine message={storageError} />;
  }

  return (
    <View accessibilityRole="radiogroup" className="gap-3">
      {presets.map((preset, index) => (
        <PresetCard
          key={preset.id}
          active={preset.id === activePresetId}
          disabled={disabled}
          editable={editable}
          index={index}
          onChoose={() => setActivePreset(preset.id)}
          preset={preset}
        />
      ))}
    </View>
  );
}
