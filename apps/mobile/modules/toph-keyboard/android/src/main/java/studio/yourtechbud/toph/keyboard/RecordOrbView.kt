package studio.yourtechbud.toph.keyboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.view.MotionEvent
import android.widget.Button
import androidx.core.content.ContextCompat
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// Home's lengths, in React Native units; SCALE draws them at the keyboard's size.
private const val ORB = 132f
private const val STAGE = 248f
private const val RING_STAGGER_MS = 700L
private const val RING_MS = 2100L
private const val ARC_SIZE = ORB + 30
private const val ARC_RADIUS = ARC_SIZE / 2 - 3

/** The keyboard draws Home's orb at 42 %, the compact layout of the UI review. */
private const val SCALE = 0.42f

/**
 * The native port of Home's record orb (`src/modules/dictation/components/RecordOrb.tsx`); a change
 * to either must be mirrored in the other. At rest it breathes; while listening it turns "on air"
 * and sends ripples outward; while transcribing an arc orbits it. Reduced motion keeps every state,
 * without the movement. Only the orb itself is pressable, as on Home.
 */
internal class RecordOrbView(context: Context) : MotionView(context) {
  private var mode = OrbMode.Rest
  private var labelOverride: String? = null

  private val unit = SCALE * resources.displayMetrics.density

  private fun px(value: Float): Float = value * unit

  // RecordOrb: the "on air" layer's opacity.
  private val live = Tween(0f)

  /** The press feel; none means at rest. */
  private var spring: PressSpring? = null

  /** Whether the current touch landed on the orb. Only those press it, as on Home, where the stage is not pressable. */
  private var accepted = false

  // BreathingHalo
  private val haloShown = Tween(1f)
  private val breath = Loop { elapsed ->
    // withRepeat(withTiming(1, 2600 ms, inOut(sin)), -1, true): there and back.
    val leg = elapsed % 5200
    Easings.inOutSin.getInterpolation(if (leg < 2600) leg / 2600f else 2 - leg / 2600f)
  }

  // Ripple, three of them
  private val ripplesShown = Tween(0f)
  private val ripples =
    List(3) { index ->
      Loop { elapsed ->
        val delayed = elapsed - index * RING_STAGGER_MS
        if (delayed < 0) 0f else Easings.outQuad.getInterpolation((delayed % RING_MS).toFloat() / RING_MS)
      }
    }

  // OrbitArc
  private val arcShown = Tween(0f)
  private val turn = Loop { elapsed -> (elapsed % 1100) / 1100f }

  private val haloFill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val haloStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val ringStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val arcTrack = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val arcDash = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
  private val base = Paint(Paint.ANTI_ALIAS_FLAG)
  private val onAir = Paint(Paint.ANTI_ALIAS_FLAG)
  private val sheen = Paint(Paint.ANTI_ALIAS_FLAG)
  private val glowPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val arcBounds = RectF()

  private val mic = icon(R.drawable.toph_keyboard_mic)
  private val square = icon(R.drawable.toph_keyboard_square)
  private val audioLines = icon(R.drawable.toph_keyboard_audio_lines)

  /** The `boxShadow` glow, blurred once per colour when the size changes rather than every frame. */
  private var restGlow: Bitmap? = null
  private var liveGlow: Bitmap? = null

  init {
    isClickable = true
    isFocusable = true
    showLabel()
  }

  fun show(mode: OrbMode, labelOverride: String?) {
    val changed = refreshReducedMotion() || mode != this.mode
    this.mode = mode
    this.labelOverride = labelOverride
    showLabel()
    if (!changed) return
    isEnabled = mode != OrbMode.Busy
    if (!isEnabled && accepted) {
      accepted = false
      pressTo(0f)
    }
    sync(now(), animate = !reduceMotion, restartLoops = false)
    invalidate()
  }

  private fun showLabel() {
    contentDescription =
      labelOverride
        ?: when (mode) {
          OrbMode.Live -> "Stop recording"
          OrbMode.Busy -> "Transcribing"
          OrbMode.Rest -> "Start recording"
        }
  }

  /** Home's effects, run when the mode or reduced motion changes, or from the start on attach. */
  private fun sync(now: Long, animate: Boolean, restartLoops: Boolean) {
    live.to(if (mode == OrbMode.Live) 1f else 0f, 600, Easings.easeOut, now, animate)

    val rest = mode == OrbMode.Rest
    haloShown.to(if (rest) 1f else 0f, 500, Easings.inOutQuad, now, animate)
    if (rest && !reduceMotion) {
      // Home resumes the breath from where it stopped; here it starts again from 0 (decision log).
      if (restartLoops || !breath.isRunning) breath.start(now)
    } else {
      breath.stop(now)
    }

    val listening = mode == OrbMode.Live
    ripplesShown.to(if (listening) 1f else 0f, 400, Easings.inOutQuad, now, animate)
    ripples.forEach { ripple ->
      when {
        listening && reduceMotion -> ripple.hold(0.35f)
        listening -> if (restartLoops || !ripple.isRunning) ripple.start(now)
        else -> ripple.hold(0f)
      }
    }

    val busy = mode == OrbMode.Busy
    arcShown.to(if (busy) 1f else 0f, 400, Easings.inOutQuad, now, animate)
    if (busy && !reduceMotion) {
      if (restartLoops || !turn.isRunning) turn.start(now)
    } else {
      turn.stop(now)
    }
  }

  override fun restart(now: Long) {
    isEnabled = mode != OrbMode.Busy
    spring = null
    sync(now, animate = false, restartLoops = true)
  }

  override fun isMoving(now: Long): Boolean =
    live.isRunning(now) ||
      spring?.isRunning(now) == true ||
      haloShown.isRunning(now) ||
      ripplesShown.isRunning(now) ||
      arcShown.isRunning(now) ||
      breath.isRunning ||
      turn.isRunning ||
      ripples.any { it.isRunning }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val stage = ceil(px(STAGE)).toInt()
    setMeasuredDimension(resolveSize(stage, widthMeasureSpec), resolveSize(stage, heightMeasureSpec))
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    val cx = width / 2f
    val cy = height / 2f
    val radius = px(ORB) / 2
    val left = cx - radius
    val top = cy - radius
    val diameter = 2 * radius
    base.shader =
      LinearGradient(
        left,
        top,
        left + diameter,
        top + diameter,
        intArrayOf(Palette.spark, Palette.accentBlue, Palette.accentViolet),
        null,
        Shader.TileMode.CLAMP,
      )
    onAir.shader = LinearGradient(left, top, left + diameter, top + diameter, Palette.accentAmber, Palette.accentRed, Shader.TileMode.CLAMP)
    // A soft top-left sheen, so the orb reads as lit rather than flat.
    sheen.shader =
      LinearGradient(
        left + 0.15f * diameter,
        top,
        left + 0.6f * diameter,
        top + 0.6f * diameter,
        withAlpha(Palette.white, 0.28f),
        withAlpha(Palette.white, 0f),
        Shader.TileMode.CLAMP,
      )
    haloFill.color = withAlpha(Palette.spark, 0.06f)
    haloStroke.color = withAlpha(Palette.spark, 0.6f)
    haloStroke.strokeWidth = px(1.5f)
    ringStroke.strokeWidth = px(2f)
    arcTrack.strokeWidth = px(3f)
    arcDash.strokeWidth = px(3f)
    arcBounds.set(cx - px(ARC_RADIUS), cy - px(ARC_RADIUS), cx + px(ARC_RADIUS), cy + px(ARC_RADIUS))

    restGlow?.recycle()
    liveGlow?.recycle()
    restGlow = glow(withAlpha(Palette.spark, 0.45f))
    liveGlow = glow(withAlpha(Palette.accentRed, 0.45f))
  }

  /**
   * Home's `boxShadow: 0px 0px 48px`, at SCALE. A CSS blur length is twice the Gaussian sigma, so
   * sigma is 24 × SCALE dp. Skia turns a `BlurMaskFilter` radius r into sigma = 0.57735 r + 0.5 (in
   * pixels), so the radius is worked back from that sigma. The bitmap pads the orb by 3 sigma on
   * each side, so the blur's tail is not cut off.
   */
  private fun glow(color: Int): Bitmap {
    val sigma = px(48f) / 2
    val blurRadius = (sigma - 0.5f) / 0.57735f
    val radius = px(ORB) / 2
    val size = ceil(2 * (radius + 3 * sigma)).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        maskFilter = BlurMaskFilter(blurRadius, BlurMaskFilter.Blur.NORMAL)
      }
    Canvas(bitmap).drawCircle(size / 2f, size / 2f, radius, paint)
    return bitmap
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    accepted = false
    spring = null
  }

  override fun draw(canvas: Canvas, now: Long) {
    val cx = width / 2f
    val cy = height / 2f
    val radius = px(ORB) / 2
    drawHalo(canvas, now, cx, cy, radius)
    drawRipples(canvas, now, cx, cy, radius)
    drawArc(canvas, now, cx, cy)
    drawOrb(canvas, now, cx, cy, radius)
  }

  private fun drawHalo(canvas: Canvas, now: Long, cx: Float, cy: Float, radius: Float) {
    val shown = haloShown.valueAt(now)
    if (shown <= 0f) return
    val breath = breath.valueAt(now)
    val opacity = shown * (0.35f + breath * 0.3f)
    val scale = 1.18f + breath * 0.08f
    canvas.save()
    canvas.scale(scale, scale, cx, cy)
    haloFill.alpha = alphaOf(withAlpha(Palette.spark, 0.06f), opacity)
    canvas.drawCircle(cx, cy, radius, haloFill)
    // React Native draws a border inside the box.
    haloStroke.alpha = alphaOf(withAlpha(Palette.spark, 0.6f), opacity)
    canvas.drawCircle(cx, cy, radius - haloStroke.strokeWidth / 2, haloStroke)
    canvas.restore()
  }

  private fun drawRipples(canvas: Canvas, now: Long, cx: Float, cy: Float, radius: Float) {
    val shown = ripplesShown.valueAt(now)
    if (shown <= 0f) return
    for (ripple in ripples) {
      val progress = ripple.valueAt(now)
      val opacity = shown * (1 - progress) * 0.6f
      if (opacity <= 0f) continue
      val scale = 1 + progress * 0.85f
      canvas.save()
      canvas.scale(scale, scale, cx, cy)
      ringStroke.color = withAlpha(Palette.accentRed, opacity)
      canvas.drawCircle(cx, cy, radius - ringStroke.strokeWidth / 2, ringStroke)
      canvas.restore()
    }
  }

  private fun drawArc(canvas: Canvas, now: Long, cx: Float, cy: Float) {
    val shown = arcShown.valueAt(now)
    if (shown <= 0f) return
    canvas.save()
    canvas.rotate(turn.valueAt(now) * 360, cx, cy)
    arcTrack.color = Palette.lineStrong
    arcTrack.alpha = alphaOf(Palette.lineStrong, shown)
    canvas.drawOval(arcBounds, arcTrack)
    // The SVG dash starts at three o'clock and runs clockwise, 22 % of the circle.
    arcDash.color = withAlpha(Palette.spark, shown)
    canvas.drawArc(arcBounds, 0f, 0.22f * 360, false, arcDash)
    canvas.restore()
  }

  private fun drawOrb(canvas: Canvas, now: Long, cx: Float, cy: Float, radius: Float) {
    val pressed = spring?.valueAt(now) ?: 0f
    val scale = 1 - pressed * 0.06f
    canvas.save()
    canvas.scale(scale, scale, cx, cy)

    (if (mode == OrbMode.Live) liveGlow else restGlow)?.let { bitmap ->
      canvas.drawBitmap(bitmap, cx - bitmap.width / 2f, cy - bitmap.height / 2f, glowPaint)
    }
    canvas.drawCircle(cx, cy, radius, base)
    val onAirOpacity = live.valueAt(now)
    if (onAirOpacity > 0f) {
      onAir.alpha = (onAirOpacity * 255).roundToInt()
      canvas.drawCircle(cx, cy, radius, onAir)
    }
    canvas.drawCircle(cx, cy, radius, sheen)

    val icon =
      when (mode) {
        OrbMode.Live -> square
        OrbMode.Busy -> audioLines
        OrbMode.Rest -> mic
      }
    val half = px(if (mode == OrbMode.Live) 34f else 44f) / 2
    icon.setBounds((cx - half).roundToInt(), (cy - half).roundToInt(), (cx + half).roundToInt(), (cy + half).roundToInt())
    icon.draw(canvas)
    canvas.restore()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!isEnabled) return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        accepted = onOrb(event)
        if (accepted) pressTo(1f)
        return accepted
      }
      MotionEvent.ACTION_UP -> {
        if (!accepted) return false
        accepted = false
        pressTo(0f)
        if (onOrb(event)) performClick()
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        if (accepted) pressTo(0f)
        accepted = false
        return true
      }
    }
    return accepted
  }

  override fun performClick(): Boolean = super.performClick()

  override fun getAccessibilityClassName(): CharSequence = Button::class.java.name

  private fun onOrb(event: MotionEvent): Boolean = hypot(event.x - width / 2f, event.y - height / 2f) <= px(ORB) / 2

  /**
   * Home's `withSpring`: in with damping 20 and stiffness 400, out with damping 12 and stiffness
   * 220. Under reduced motion the press stays at rest and the release snaps.
   */
  private fun pressTo(target: Float) {
    val now = now()
    val from = spring?.valueAt(now) ?: 0f
    spring =
      when {
        reduceMotion -> null
        target == 1f -> PressSpring(from, target, damping = 20f, stiffness = 400f, startedAt = now)
        else -> PressSpring(from, target, damping = 12f, stiffness = 220f, startedAt = now)
      }
    invalidate()
  }

  private fun icon(id: Int): Drawable =
    ContextCompat.getDrawable(context, id)!!.mutate().apply { setTint(Palette.canvas) }
}

/**
 * Reanimated's spring (mass 1), in closed form: an underdamped spring released from `from` toward
 * `to`. It starts at rest, so a release in the middle of a press-in keeps the scale but not the
 * velocity.
 */
private class PressSpring(private val from: Float, private val to: Float, damping: Float, stiffness: Float, private val startedAt: Long) {
  private val omega = sqrt(stiffness)
  private val zeta = damping / (2 * omega)
  private val decay = zeta * omega
  private val omegaDamped = omega * sqrt(1 - zeta * zeta)

  /** Seconds until the swing is under a thousandth of the distance. */
  private val settleSeconds = ln(1000f) / decay

  fun isRunning(now: Long): Boolean = (now - startedAt) / 1000f < settleSeconds

  fun valueAt(now: Long): Float {
    val t = (now - startedAt) / 1000f
    if (t >= settleSeconds) return to
    val offset = from - to
    return to + exp(-decay * t) * (offset * cos(omegaDamped * t) + decay * offset / omegaDamped * sin(omegaDamped * t))
  }
}

/** A colour's own alpha times an opacity, as a paint alpha. */
private fun alphaOf(color: Int, opacity: Float): Int = (Color.alpha(color) * opacity).roundToInt()
