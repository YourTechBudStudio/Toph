import { useEffect, useState } from 'react';

const TICK_MS = 30_000;

/** The current time, refreshed often enough for "4m ago" to stay honest. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}
