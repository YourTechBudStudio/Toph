package studio.yourtechbud.toph.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.security.MessageDigest

/**
 * Silero VAD v5 on ONNX Runtime Android: a port of the `SileroV5` step in `@ricky0123/vad-web`
 * (`dist/models/v5.js`), which desktop scores with.
 *
 * - inputs: `input` float32 [1, 512] (no context prefix), `state` float32 [2, 1, 128], `sr` int64
 *   [1] = 16000;
 * - outputs: `output` (the speech probability) and `stateN`, which replaces the state;
 * - [reset] zeroes the state, as vad-web's `reset_state()` does.
 *
 * The model is desktop's own `silero_vad_v5.onnx`, copied from vad-web at build time. One process-wide
 * instance, loaded on first use. Not thread-safe: the module lets one capture or scoring run use it
 * at a time.
 */
internal class SileroVad private constructor(private val session: OrtSession) {
  private val env = OrtEnvironment.getEnvironment()
  private val sr = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(Wav.SAMPLE_RATE.toLong())), longArrayOf(1))
  private var state = FloatArray(STATE_SIZE)

  fun reset() {
    state = FloatArray(STATE_SIZE)
  }

  /** Scores one 512-sample frame and advances the recurrent state. */
  fun process(frame: FloatArray): Float {
    require(frame.size == FRAME_SIZE) { "Silero v5 frames are $FRAME_SIZE samples." }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(frame), longArrayOf(1, FRAME_SIZE.toLong())).use { input ->
      OnnxTensor.createTensor(env, FloatBuffer.wrap(state), longArrayOf(2, 1, 128)).use { stateTensor ->
        session.run(mapOf("input" to input, "state" to stateTensor, "sr" to sr)).use { result ->
          val stateN = result.get("stateN").orElseThrow { IllegalStateException("No state from model") } as OnnxTensor
          val output = result.get("output").orElseThrow { IllegalStateException("No output from model") } as OnnxTensor
          val next = FloatArray(STATE_SIZE)
          stateN.floatBuffer.get(next)
          state = next
          return output.floatBuffer.get(0)
        }
      }
    }
  }

  companion object {
    const val FRAME_SIZE = 512
    private const val STATE_SIZE = 2 * 1 * 128
    private const val MODEL_ASSET = "silero_vad_v5.onnx"

    @Volatile private var instance: SileroVad? = null

    /**
     * The loaded model, loading it on first use with one warm-up inference. A failed load is not
     * cached, so the next call tries again.
     */
    fun shared(context: Context): SileroVad =
      instance ?: synchronized(this) {
        instance ?: load(context).also { instance = it }
      }

    private fun load(context: Context): SileroVad {
      val startedAt = SystemClock.elapsedRealtime()
      val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
      val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
      // Single-threaded, like vad-web's wasm backend.
      val options =
        OrtSession.SessionOptions().apply {
          setIntraOpNumThreads(1)
          setInterOpNumThreads(1)
        }
      val vad = SileroVad(OrtEnvironment.getEnvironment().createSession(bytes, options))
      // The warm-up pays the first inference's setup cost here; the reset keeps it out of results.
      vad.process(FloatArray(FRAME_SIZE))
      vad.reset()
      Log.i(TAG, "Silero loaded: ${bytes.size} bytes, sha256 $sha256, ${SystemClock.elapsedRealtime() - startedAt}ms")
      return vad
    }
  }
}
