import { useEffect, useState } from 'react';

const TICK_MS = 250;

/** Milliseconds since `startedAt`, ticking while there is a start. */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
