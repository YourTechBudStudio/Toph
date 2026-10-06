const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4m ago", "3h ago", "yesterday", then "5d ago". */
export function formatRelative(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return `${String(Math.floor(elapsed / MINUTE))}m ago`;
  }
  if (elapsed < DAY) {
    return `${String(Math.floor(elapsed / HOUR))}h ago`;
  }
  if (elapsed < 2 * DAY) {
    return 'yesterday';
  }
  return `${String(Math.floor(elapsed / DAY))}d ago`;
}

/** A recording length as a clock: "0:07", "1:42", "12:05". */
export function formatClock(durationMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

/** Spoken pace in words per minute, or null when the recording is too short to say. */
export function wordsPerMinute(text: string, durationMs: number): number | null {
  if (durationMs < 3000) {
    return null;
  }
  return Math.round(countWords(text) / (durationMs / MINUTE));
}
