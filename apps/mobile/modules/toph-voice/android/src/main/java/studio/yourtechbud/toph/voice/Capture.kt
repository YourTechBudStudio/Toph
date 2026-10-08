package studio.yourtechbud.toph.voice

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.max

internal typealias EmitFrames = (frames: List<ScoredFrame>, final: Boolean, error: String?) -> Unit

/**
 * One microphone capture into raw.wav, scored as it goes.
 *
 * A dedicated thread reads about 100 ms at a time, appends it to raw.wav, and only then scores it,
 * so any range JS plans from emitted frames is already on disk. The file is written through an
 * unbuffered [RandomAccessFile], so a separate read handle (batch cutting) sees every byte written.
 * [stop] emits exactly one final event on every path; a mic failure on the way travels on it.
 */
internal class Capture private constructor(
  private val record: AudioRecord,
  private val file: RandomAccessFile,
  private val scorer: FrameScorer,
  private val emit: EmitFrames,
) {
  @Volatile private var running = true
  private var dataBytes = 0L

  // The capture's first error. Written by the capture thread and by teardown steps.
  @Volatile private var error: String? = null

  private val thread =
    Thread({ captureLoop() }, "TophVoiceCapture").apply {
      start()
    }

  private fun captureLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    val samples = ShortArray(READ_SAMPLES)
    try {
      while (running) {
        val read = record.read(samples, 0, samples.size)
        if (read < 0) {
          // A read unblocked by `stop()` is not a failure.
          if (running) error = "Microphone read failed (code $read)."
          break
        }
        if (read == 0) continue
        // Write before scoring: frames are only emitted for audio already on disk.
        file.write(Wav.toBytes(samples, read))
        dataBytes += read * 2L
        val frames = scorer.process(samples, read)
        if (frames.isNotEmpty()) emit(frames, false, null)
      }
    } catch (throwable: Throwable) {
      error = throwable.message ?: throwable.javaClass.simpleName
    }
  }

  /** Ends capture, scores the tail, patches the header, then emits the final event. Never throws. */
  fun stop() {
    var tail: List<ScoredFrame> = emptyList()
    try {
      endRecording()
      guarded { tail = scorer.flush() }
      guarded {
        file.seek(0)
        file.write(Wav.header(dataBytes))
      }
      guarded { file.close() }
      Log.i(TAG, "Capture stopped: ${dataBytes / 2} samples${error?.let { ", error: $it" } ?: ""}")
    } finally {
      emit(tail, true, error)
    }
  }

  /** Ends capture without emitting anything. For module teardown only. */
  fun abandon() {
    endRecording()
    guarded { file.close() }
  }

  private fun endRecording() {
    running = false
    guarded { record.stop() } // unblocks a pending read
    guarded { thread.join() }
    guarded { record.release() }
  }

  /** Runs one teardown step; a failure only records the capture's first error. */
  private inline fun guarded(step: () -> Unit) {
    try {
      step()
    } catch (throwable: Throwable) {
      if (error == null) error = throwable.message ?: throwable.javaClass.simpleName
    }
  }

  companion object {
    private const val READ_SAMPLES = 1_600 // 100 ms
    private const val MIN_BUFFER_BYTES = 6_400 // 200 ms

    /** Opens raw.wav, starts AudioRecord and the capture thread. Cleans up and throws on any failure. */
    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the app before it records.
    fun start(rawFile: File, scorer: FrameScorer, emit: EmitFrames): Capture {
      var file: RandomAccessFile? = null
      var record: AudioRecord? = null
      try {
        rawFile.parentFile?.mkdirs()
        file = RandomAccessFile(rawFile, "rw").apply {
          setLength(0)
          write(Wav.header(0))
        }
        val channel = AudioFormat.CHANNEL_IN_MONO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val bufferBytes = max(AudioRecord.getMinBufferSize(Wav.SAMPLE_RATE, channel, encoding), MIN_BUFFER_BYTES)
        record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, Wav.SAMPLE_RATE, channel, encoding, bufferBytes)
        if (record.state != AudioRecord.STATE_INITIALIZED) {
          throw IllegalStateException("The microphone could not be started.")
        }
        record.startRecording()
        // Another app holding the microphone shows up here.
        if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
          throw IllegalStateException("The microphone is busy or unavailable.")
        }
        Log.i(TAG, "Capture started: ${rawFile.name}, buffer $bufferBytes bytes")
        return Capture(record, file, scorer, emit)
      } catch (throwable: Throwable) {
        runCatching { record?.stop() }
        runCatching { record?.release() }
        runCatching { file?.close() }
        throw throwable
      }
    }
  }
}
