/** Retention, as desktop has always done it: the newest this many finished sessions keep their audio and stay listed. */
export const retainedSessionCount = 10;

/** Statuses that count toward retention and appear in history. `cancelled` and `removed` never do. */
export const retainableSessionStatuses = [
  'recorded',
  'segmented',
  'completed',
  'failed',
  'no_speech',
  'recording_failed',
] as const;
