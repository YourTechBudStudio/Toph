import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * A number that goes up each time the app comes back from the background (not from a brief
 * `inactive`, such as the notification shade).
 */
export function useForegroundKey(): number {
  const [key, setKey] = useState(0);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous === 'background' && next === 'active') {
        setKey((current) => current + 1);
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);

  return key;
}
