package studio.yourtechbud.toph.voice

/** One scored frame, as sample offsets from the start of the audio. */
internal data class ScoredFrame(val startSample: Long, val endSample: Long, val probability: Float)

/**
 * Splits PCM16 into consecutive 512-sample frames from sample 0 and scores each with Silero.
 *
 * Mirrors desktop's `apps/desktop/src/main/segmentation/streaming/pcm-frame-buffer.ts`: samples are
 * `int16 / 32768`, and [flush] zero-pads the remainder into one frame whose end is the real sample
 * count, then resets Silero. Milliseconds are left to JS, which rounds with desktop's expression and
 * drops frames that round to zero length. One instance per capture or scoring run; creating it
 * resets Silero, as desktop's reusable Silero session does.
 */
internal class FrameScorer(private val vad: SileroVad) {
  private val pending = FloatArray(SileroVad.FRAME_SIZE)
  private var pendingCount = 0
  private var processedSamples = 0L

  init {
    vad.reset()
  }

  fun process(samples: ShortArray, count: Int): List<ScoredFrame> {
    val frames = ArrayList<ScoredFrame>()
    for (i in 0 until count) {
      pending[pendingCount] = samples[i] / 32768f
      pendingCount += 1
      if (pendingCount == SileroVad.FRAME_SIZE) {
        val start = processedSamples
        val probability = vad.process(pending)
        processedSamples += SileroVad.FRAME_SIZE
        pendingCount = 0
        frames.add(ScoredFrame(start, processedSamples, probability))
      }
    }
    return frames
  }

  fun flush(): List<ScoredFrame> {
    if (pendingCount == 0) {
      vad.reset()
      return emptyList()
    }
    pending.fill(0f, pendingCount)
    val start = processedSamples
    val probability = vad.process(pending)
    processedSamples += pendingCount
    pendingCount = 0
    vad.reset()
    return listOf(ScoredFrame(start, processedSamples, probability))
  }
}
