/**
 * Join batch transcripts into one raw transcript.
 *
 * Exported because incremental polishing assembles the same batch texts as it goes, and a
 * divergence here would make the polished document silently cover different text from the raw
 * output it names as its source.
 */
export function assembleRawTranscriptText(texts: string[]) {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
