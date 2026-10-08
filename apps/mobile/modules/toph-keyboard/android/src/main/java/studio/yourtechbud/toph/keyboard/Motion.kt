package studio.yourtechbud.toph.keyboard

import android.animation.TimeInterpolator
import android.content.Context
import android.graphics.Canvas
import android.provider.Settings
import android.view.View
import android.view.animation.AnimationUtils
import android.view.animation.PathInterpolator
import kotlin.math.PI
import kotlin.math.cos

/**
 * Reanimated's `useReducedMotion` (`NativeProxy.getIsReducedMotion`): the transition animation
 * scale is 0, which "Remove animations" sets. Reading the same setting keeps the keyboard still
 * exactly when Home is.
 */
internal fun isReducedMotion(context: Context): Boolean {
  val raw = Settings.Global.getString(context.contentResolver, Settings.Global.TRANSITION_ANIMATION_SCALE)
  return (raw?.toFloatOrNull() ?: 1f) == 0f
}

/** The easings Home's visuals use, as Reanimated defines them. */
internal object Easings {
  /** The house ease, `easeOut` in `apps/mobile/src/ui/core/motion.ts`. */
  val easeOut: TimeInterpolator = PathInterpolator(0.16f, 1f, 0.3f, 1f)

  /** `Easing.inOut(Easing.quad)`, also `withTiming`'s default. */
  val inOutQuad = TimeInterpolator { t -> if (t < 0.5f) 2 * t * t else 1 - 2 * (1 - t) * (1 - t) }

  /** `Easing.inOut(Easing.sin)`. */
  val inOutSin = TimeInterpolator { t -> ((1 - cos(t * PI)) / 2).toFloat() }

  /** `Easing.out(Easing.quad)`. */
  val outQuad = TimeInterpolator { t -> 1 - (1 - t) * (1 - t) }

  val linear = TimeInterpolator { t -> t }
}

/** A `withTiming` from wherever the value is now. Reduced motion and re-attaching snap instead. */
internal class Tween(initial: Float) {
  private var from = initial
  private var to = initial
  private var startedAt = 0L
  private var durationMs = 0L
  private var easing = Easings.linear

  fun to(target: Float, durationMs: Long, easing: TimeInterpolator, now: Long, animate: Boolean) {
    if (!animate) {
      from = target
      to = target
      this.durationMs = 0L
      return
    }
    if (target == to) return
    from = valueAt(now)
    to = target
    startedAt = now
    this.durationMs = durationMs
    this.easing = easing
  }

  fun isRunning(now: Long): Boolean = durationMs > 0 && now < startedAt + durationMs

  fun valueAt(now: Long): Float {
    if (!isRunning(now)) return to
    val fraction = maxOf(0f, (now - startedAt).toFloat() / durationMs)
    return from + (to - from) * easing.getInterpolation(fraction)
  }
}

/**
 * A repeating value, worked out from the time since it started. Stopping holds it where it is, as
 * Reanimated's `cancelAnimation` does.
 */
internal class Loop(private val value: (elapsedMs: Long) -> Float) {
  private var startedAt = -1L
  private var held = 0f

  val isRunning: Boolean
    get() = startedAt >= 0

  fun start(now: Long) {
    startedAt = now
  }

  fun stop(now: Long) {
    if (isRunning) held = value(now - startedAt)
    startedAt = -1L
  }

  fun hold(value: Float) {
    held = value
    startedAt = -1L
  }

  fun valueAt(now: Long): Float = if (isRunning) value(now - startedAt) else held
}

/**
 * A view that draws its animations from frame timestamps rather than `ValueAnimator`s, so that,
 * like Reanimated, its timing ignores the animator duration scale. It asks for the next frame only
 * while it is attached, its window is visible and something is moving, so the keyboard costs
 * nothing at rest inside other apps. A detached view's pending frame is dropped by Android.
 */
internal abstract class MotionView(context: Context) : View(context) {
  protected var reduceMotion = false
    private set

  /** Draws the frame at `now`, the frame's animation time. */
  protected abstract fun draw(canvas: Canvas, now: Long)

  protected abstract fun isMoving(now: Long): Boolean

  /** Called on attach: one-off fades snap to the current state, and loops start from the beginning. */
  protected abstract fun restart(now: Long)

  /** Re-reads the setting; true when it changed. */
  protected fun refreshReducedMotion(): Boolean {
    val reduce = isReducedMotion(context)
    val changed = reduce != reduceMotion
    reduceMotion = reduce
    return changed
  }

  protected fun now(): Long = AnimationUtils.currentAnimationTimeMillis()

  final override fun onDraw(canvas: Canvas) {
    val now = now()
    draw(canvas, now)
    if (isAttachedToWindow && windowVisibility == VISIBLE && isMoving(now)) postInvalidateOnAnimation()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    refreshReducedMotion()
    restart(now())
    invalidate()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility == VISIBLE) invalidate()
  }
}
