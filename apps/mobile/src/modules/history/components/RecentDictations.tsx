import { Fragment } from 'react';
import { Text, View } from 'react-native';

import { SectionLabel } from '../../../ui';
import { useHistory } from '../state/history';
import { useNow } from '../state/now';
import { DictationRow } from './DictationRow';

/** Every saved dictation from the app and the keyboard, newest first. */
export function RecentDictations() {
  const { loaded, dictations } = useHistory();
  const now = useNow();

  return (
    <View>
      <View className="flex-row items-baseline justify-between">
        <SectionLabel>Recent</SectionLabel>
        {loaded ? (
          <Text className="font-body text-xs text-text-tertiary">{dictations.length} saved</Text>
        ) : null}
      </View>
      {/* Until the first read settles, the header shows alone: no rows and no empty state. */}
      {!loaded ? null : dictations.length === 0 ? (
        <View className="items-center rounded-card border border-dashed border-line-strong px-6 py-10">
          <Text className="font-display text-base text-text-primary">Nothing here yet.</Text>
          <Text className="mt-1 text-center font-body text-sm text-text-tertiary">
            Say something brilliant. Or mediocre. I don't judge, I just transcribe.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-card border border-line bg-white/3">
          {dictations.map((dictation, index) => (
            <Fragment key={dictation.id}>
              {index === 0 ? null : <View className="mx-5 h-px bg-line" />}
              <DictationRow dictation={dictation} now={now} />
            </Fragment>
          ))}
        </View>
      )}
    </View>
  );
}
