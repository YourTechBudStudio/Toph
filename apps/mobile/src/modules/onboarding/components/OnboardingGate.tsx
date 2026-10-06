import { useEffect, useState, type ReactNode } from 'react';

import { useReadiness } from '../state/readiness';
import { OnboardingScreen } from './OnboardingScreen';

/**
 * Shows onboarding instead of the app whenever a prerequisite is missing, including one that goes
 * missing later, such as removing the provider. Once onboarding is up it stays until you tap
 * Continue, so finishing the last step never yanks the screen away mid-read.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { ready } = useReadiness();
  const [onboarding, setOnboarding] = useState(!ready);

  useEffect(() => {
    if (!ready) {
      setOnboarding(true);
    }
  }, [ready]);

  if (onboarding) {
    return <OnboardingScreen onContinue={() => setOnboarding(false)} />;
  }
  return children;
}
