import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, TextField } from '../../../ui';
import { DEFAULT_BASE_URL, useProviderStore } from '../state/provider';

/**
 * The OpenAI connection form: base URL and API key, submitted together. Onboarding and Settings
 * share it, so connecting means the same thing in both places.
 *
 * The fields are an unsubmitted draft; nothing is saved until Connect checks it.
 */
export function ConnectionForm() {
  // What the fields should show when they are not being edited: the credentials being checked or
  // that just failed, otherwise the saved ones.
  const shownBaseUrl = useProviderStore((state) => state.submitted?.baseUrl ?? state.baseUrl);
  const shownApiKey = useProviderStore((state) => state.submitted?.apiKey ?? state.apiKey);
  const status = useProviderStore((state) => state.status);
  const error = useProviderStore((state) => state.error);
  const connect = useProviderStore((state) => state.connect);
  const remove = useProviderStore((state) => state.remove);
  const [baseUrl, setBaseUrl] = useState(shownBaseUrl);
  const [apiKey, setApiKey] = useState(shownApiKey);
  const connecting = status === 'connecting';
  const established = status === 'connected' || status === 'invalid';

  // The store changes these only when a check settles or the connection is removed, never while
  // typing, so following them keeps every mounted form truthful without discarding edits. This
  // matters because a reconnect hands the screen to onboarding, whose form mounts mid-check.
  useEffect(() => {
    setBaseUrl(shownBaseUrl);
    setApiKey(shownApiKey);
  }, [shownApiKey, shownBaseUrl]);

  return (
    <View className="gap-4">
      <TextField
        editable={!connecting}
        hint="Any OpenAI-compatible endpoint works."
        keyboardType="url"
        label="Base URL"
        onChangeText={setBaseUrl}
        placeholder={DEFAULT_BASE_URL}
        plain
        value={baseUrl}
      />
      <TextField
        editable={!connecting}
        hint="Kept in the phone's secure storage. Never logged, never committed, never pushed on a Friday."
        label="API key"
        onChangeText={setApiKey}
        placeholder="sk-..."
        secret
        value={apiKey}
      />
      {status === 'invalid' && error !== null ? (
        <View className="rounded-tile border border-accent-red/20 bg-accent-red/10 px-4 py-3">
          <Text className="font-body text-sm leading-5 text-accent-red">{error}</Text>
        </View>
      ) : null}
      <View className="flex-row justify-end gap-3">
        {established ? (
          <Button disabled={connecting} onPress={remove} title="Remove" variant="danger" />
        ) : null}
        <Button
          disabled={connecting || baseUrl.trim() === '' || apiKey.trim() === ''}
          onPress={() => connect({ baseUrl, apiKey })}
          title={connecting ? 'Connecting…' : established ? 'Reconnect' : 'Connect'}
          variant="primary"
        />
      </View>
    </View>
  );
}
