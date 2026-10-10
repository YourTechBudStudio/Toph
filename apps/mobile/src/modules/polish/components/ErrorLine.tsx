import { Text, View } from 'react-native';

/** A failed save or unusable storage, in the red line style `ConnectionForm` uses. */
export function ErrorLine({ message }: { message: string }) {
  return (
    <View className="rounded-tile border border-accent-red/20 bg-accent-red/10 px-4 py-3">
      <Text className="font-body text-sm leading-5 text-accent-red">{message}</Text>
    </View>
  );
}
