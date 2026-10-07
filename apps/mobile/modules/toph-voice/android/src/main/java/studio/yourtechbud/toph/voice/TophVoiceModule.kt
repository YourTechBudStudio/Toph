package studio.yourtechbud.toph.voice

import android.content.Context
import android.net.Uri
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

internal const val TAG = "TophVoice"

private const val FRAMES_EVENT = "onFrames"
private const val READ_SAMPLES = 1_600 // the 100 ms a capture read delivers

/** A range of raw.wav in milliseconds, as JS's `SourceRange`. */
class SourceRange : Record {
  @Field val startMs: Double = 0.0

  @Field val endMs: Double = 0.0
}

/** A failure JS sees as a rejection with this message. */
internal class VoiceException(message: String, cause: Throwable? = null) : CodedException(message, cause)

/**
 * The JS surface of native dictation audio: capture with Silero scoring, batch cutting, and the
 * parity scorer. `modules/toph-voice/index.ts` documents the contract JS relies on.
 *
 * One Silero user at a time: a capture or a scoring run holds the model, and the other is refused
 * with "Voice detection is busy." while it does.
 */
class TophVoiceModule : Module() {
  // Guarded by `this`. `capture` is the capture in progress. `sileroInUse` is held from the moment a
  // capture or a scoring run claims Silero until it no longer touches it: through a capture's
  // start, its recording, and its stop (which scores the tail), or through a whole scoring run.
  private var capture: Capture? = null
  private var sileroInUse = false

  private val context: Context
    get() = appContext.reactContext ?: throw VoiceException("The app context is not available.")

  override fun definition() = ModuleDefinition {
    Name("TophVoice")

    Events(FRAMES_EVENT)

    AsyncFunction("startCapture") { rawWavUri: String ->
      claimSilero()
      try {
        val started = Capture.start(fileOf(rawWavUri), FrameScorer(loadSilero()), ::emitFrames)
        synchronized(this@TophVoiceModule) { capture = started }
      } catch (throwable: Throwable) {
        releaseSilero()
        throw asVoiceException(throwable, "The microphone could not be started.")
      }
    }

    AsyncFunction("stopCapture") {
      val stopping = synchronized(this@TophVoiceModule) { capture.also { capture = null } }
      // Nothing running: resolve at once and emit nothing.
      if (stopping != null) {
        try {
          stopping.stop()
        } finally {
          releaseSilero()
        }
      }
    }

    AsyncFunction("cutBatch") { rawWavUri: String, ranges: List<SourceRange>, outUri: String ->
      try {
        Wav.cutBatch(fileOf(rawWavUri), ranges.map { MsRange(it.startMs, it.endMs) }, fileOf(outUri))
      } catch (throwable: Throwable) {
        throw asVoiceException(throwable, "The batch audio could not be written.")
      }
    }

    AsyncFunction("scoreWavFile") { wavUri: String ->
      claimSilero()
      try {
        scoreWav(fileOf(wavUri))
      } catch (throwable: Throwable) {
        throw asVoiceException(throwable, "The WAV file could not be scored.")
      } finally {
        releaseSilero()
      }
    }

    // A JS reload must not leave the mic on.
    OnDestroy {
      val abandoned = synchronized(this@TophVoiceModule) { capture.also { capture = null } }
      if (abandoned != null) {
        abandoned.abandon()
        releaseSilero()
      }
    }
  }

  private fun claimSilero() {
    synchronized(this) {
      if (sileroInUse) throw VoiceException(BUSY)
      sileroInUse = true
    }
  }

  private fun releaseSilero() {
    synchronized(this) { sileroInUse = false }
  }

  private fun loadSilero(): SileroVad =
    try {
      SileroVad.shared(context)
    } catch (throwable: Throwable) {
      throw VoiceException("Voice detection could not be loaded: ${throwable.message}", throwable)
    }

  private fun emitFrames(frames: List<ScoredFrame>, final: Boolean, error: String?) {
    sendEvent(FRAMES_EVENT, framesEvent(frames, final, error))
  }

  /** Scores a whole WAV exactly as capture would: 100 ms chunks through a fresh scorer, then the tail. */
  private fun scoreWav(file: File): Map<String, Any?> {
    val samples = Wav.readPcm16Mono(file)
    val scorer = FrameScorer(loadSilero())
    val frames = ArrayList<ScoredFrame>()
    val chunk = ShortArray(READ_SAMPLES)
    var offset = 0
    while (offset < samples.size) {
      val count = minOf(READ_SAMPLES, samples.size - offset)
      samples.copyInto(chunk, 0, offset, offset + count)
      frames.addAll(scorer.process(chunk, count))
      offset += count
    }
    frames.addAll(scorer.flush())
    Log.i(TAG, "Scored ${file.name}: ${samples.size} samples, ${frames.size} frames")
    return framesEvent(frames, final = true, error = null)
  }

  private fun framesEvent(frames: List<ScoredFrame>, final: Boolean, error: String?): Map<String, Any?> =
    mapOf(
      "startSamples" to frames.map { it.startSample.toDouble() },
      "endSamples" to frames.map { it.endSample.toDouble() },
      "probabilities" to frames.map { it.probability.toDouble() },
      "final" to final,
      "error" to error,
    )

  private fun asVoiceException(throwable: Throwable, fallback: String): CodedException =
    throwable as? CodedException ?: VoiceException(throwable.message ?: fallback, throwable)

  private fun fileOf(uri: String): File =
    File(Uri.parse(uri).path ?: throw VoiceException("Not a file URI: $uri"))

  private companion object {
    const val BUSY = "Voice detection is busy."
  }
}
