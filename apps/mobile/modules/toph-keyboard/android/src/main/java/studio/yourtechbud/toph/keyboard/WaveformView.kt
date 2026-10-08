package studio.yourtechbud.toph.keyboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sin

private const val BARS = 31
private const val HEIGHT = 44f
private const val REST = 0.08f

/** How much of their full swing the bars use while active. They do not follow the mic. */
private const val SWING = 0.6f
private const val BAR_WIDTH = 3f
private const val BAR_GAP = 3f
private const val BAR_RADIUS = 2f
private const val MIN_BAR = 4f

/** Taller in the middle, quieter at the edges, so the bars read as a voice and not a meter. */
private fun envelope(index: Int): Float {
  val offset = (index - (BARS - 1) / 2f) / ((BARS - 1) / 2f)
  return 0.25f + 0.75f * exp(-2.4f * offset * offset)
}

/** Deterministic jitter per bar, so the motion looks organic without changing on every render. */
private fun jitter(index: Int, salt: Int): Float {
  val value = sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return (value - floor(value)).toFloat()
}

/**
 * The native port of Home's waveform (`src/modules/dictation/components/LiveWaveform.tsx`); a change
 * to either must be mirrored in the other. A field of bars that sways while listening and settles
 * into a flat line otherwise. It does not follow the microphone's level.
 */
internal class WaveformView(context: Context) : MotionView(context) {
  private val density = resources.displayMetrics.density
  private var active = false

  private val bars = List(BARS) { Bar(it) }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()

  /** When the current sway started, or -1 while the bars are not swaying. */
  private var swayStartedAt = -1L

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  fun show(active: Boolean) {
    val reduceChanged = refreshReducedMotion()
    if (active == this.active && !reduceChanged) return
    this.active = active
    sync(now(), animate = !reduceMotion)
    invalidate()
  }

  /** Home's per-bar effect, run when `active` or reduced motion changes, or from the start on attach. */
  private fun sync(now: Long, animate: Boolean) {
    bars.forEach { bar ->
      val current = bar.valueAt(now)
      when {
        !active -> {
          // From wherever the bar is, swaying or not.
          bar.settle.to(current, 0, Easings.linear, now, animate = false)
          bar.settle.to(0f, 500, Easings.inOutQuad, now, animate)
        }
        reduceMotion -> bar.settle.to(0.8f, 0, Easings.linear, now, animate = false)
        else -> bar.swayFrom = current
      }
    }
    swayStartedAt = if (active && !reduceMotion) now else -1L
  }

  override fun restart(now: Long) {
    swayStartedAt = -1L
    bars.forEach { it.settle.to(0f, 0, Easings.linear, now, animate = false) }
    sync(now, animate = false)
  }

  override fun isMoving(now: Long): Boolean = swayStartedAt >= 0 || bars.any { it.settle.isRunning(now) }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val width = ((BARS * BAR_WIDTH + (BARS - 1) * BAR_GAP) * density).roundToInt()
    setMeasuredDimension(resolveSize(width, widthMeasureSpec), resolveSize((HEIGHT * density).roundToInt(), heightMeasureSpec))
  }

  override fun draw(canvas: Canvas, now: Long) {
    val cy = height / 2f
    for (bar in bars) {
      val sway = bar.valueAt(now)
      val barHeight = maxOf(MIN_BAR, maxOf(REST, bar.peak * sway * SWING) * HEIGHT) * density
      val left = bar.index * (BAR_WIDTH + BAR_GAP) * density
      rect.set(left, cy - barHeight / 2, left + BAR_WIDTH * density, cy + barHeight / 2)
      paint.color =
        if (active) {
          withAlpha(Palette.accentAmber, 0.45f + bar.peak * 0.55f)
        } else {
          withAlpha(Palette.textTertiary, 0.5f)
        }
      canvas.drawRoundRect(rect, BAR_RADIUS * density, BAR_RADIUS * density, paint)
    }
  }

  /** One bar's sway, as a share of its height. */
  private inner class Bar(val index: Int) {
    val peak = envelope(index)
    private val high = 0.8f + 0.2f * jitter(index, 1)
    private val low = 0.45f + 0.2f * jitter(index, 2)
    private val pace = 260 + 260 * jitter(index, 3)
    private val delay = (jitter(index, 4) * 300).roundToInt()

    /** Where the sway starts from: wherever the bar was when it began. */
    var swayFrom = 0f
    val settle = Tween(0f)

    fun valueAt(now: Long): Float = if (swayStartedAt >= 0) swayAt((now - swayStartedAt).toFloat()) else settle.valueAt(now)

    /**
     * Home's `withDelay(withRepeat(withSequence(to high, to low), -1, true))`. `withSequence` ignores
     * the `toValue` that `reverse` sets, so each repeat runs forward again from low: after the first
     * rise from `swayFrom`, the bar goes low → high in `pace` and high → low in 0.8 × `pace`.
     */
    private fun swayAt(elapsed: Float): Float {
      var t = elapsed - delay
      if (t < 0) return swayFrom
      if (t < pace) return lerp(swayFrom, high, t / pace)
      t -= pace
      val fall = pace * 0.8f
      if (t < fall) return lerp(high, low, t / fall)
      t = (t - fall) % (pace + fall)
      return if (t < pace) lerp(low, high, t / pace) else lerp(high, low, (t - pace) / fall)
    }

    private fun lerp(from: Float, to: Float, fraction: Float): Float = from + (to - from) * Easings.inOutQuad.getInterpolation(fraction)
  }
}
