package studio.yourtechbud.toph.keyboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import kotlin.math.roundToInt

/** Home's `RecordOrb` modes: breathing at rest, ripples while listening, orbiting arc while transcribing. */
internal enum class OrbMode { Rest, Live, Busy }

internal enum class CaptionTone { Muted, Error, Link }

internal sealed interface Headline {
  data class Text(val text: String, val animatedDots: Boolean = false) : Headline

  /** Home's recording clock ("0:07"), counted from `elapsedRealtime`. */
  data class Clock(val startedAt: Long) : Headline
}

internal data class PanelCopy(val headline: Headline, val caption: String, val tone: CaptionTone = CaptionTone.Muted) {
  /** The keyboard's fixed wording. A result's wording is beside `KeyboardResult` (`panelCopy()`, `notice()`). */
  companion object {
    val Idle = PanelCopy(Headline.Text("Tap to dictate"), "Tap the mic and speak.")
    val MicMissing = PanelCopy(Headline.Text("Microphone is off"), "Allow the microphone in Toph ›", CaptionTone.Link)
    val Starting = PanelCopy(Headline.Text("Starting", animatedDots = true), "Getting the mic ready. Tap to cancel.")
    val Transcribing = PanelCopy(Headline.Text("Transcribing…"), "Sending what's left of your recording.")

    fun listening(startedAt: Long) = PanelCopy(Headline.Clock(startedAt), "Listening. Tap the orb when you are done.")
  }
}

internal data class PanelState(
  val orb: OrbMode,
  val copy: PanelCopy,
  /** Overrides the orb's content description; Home's labels otherwise. */
  val orbLabel: String? = null,
)

/** The design tokens the keyboard and its orb and waveform draw with. `apps/mobile/global.css` is the source of truth. */
internal object Palette {
  val canvas = Color.parseColor("#24273a")
  val textPrimary = Color.parseColor("#cad3f5")
  val textTertiary = Color.parseColor("#6e738d")
  val accentBlue = Color.parseColor("#8aadf4")
  val accentViolet = Color.parseColor("#c6a0f6")
  val accentAmber = Color.parseColor("#f5a97f")
  val accentRed = Color.parseColor("#ed8796")
  val accentCyan = Color.parseColor("#91d7e3")
  val spark = Color.parseColor("#7dc4e4")
  val lineStrong = Color.argb(26, 255, 255, 255) // rgba(255, 255, 255, 0.1)
  val white = Color.WHITE
}

/** `withAlpha` from `src/ui/theme.ts`: the colour at an opacity. */
internal fun withAlpha(color: Int, alpha: Float): Int =
  Color.argb((alpha * 255).roundToInt(), Color.red(color), Color.green(color), Color.blue(color))

private const val CLOCK_TICK_MS = 250L // Home's useElapsed
private const val DOTS_TICK_MS = 400L

/**
 * The keyboard's view, in the compact layout of Home's dictation panel: the orb on the left, and a
 * left-aligned column with the headline, a caption of at most two lines and the waveform.
 */
internal class KeyboardPanel(context: Context, onMic: () -> Unit, private val onOpenApp: () -> Unit) {
  private val density = context.resources.displayMetrics

  private fun dp(value: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, density).toInt()

  private fun sp(value: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, density).toInt()

  private val orb = RecordOrbView(context).apply { setOnClickListener { onMic() } }

  // The app's fonts (global.css: --font-display, --font-body, --font-body-semibold), copied in at build time.
  private val displayFont = font(context, R.font.toph_keyboard_sora_semibold)
  private val bodyFont = font(context, R.font.toph_keyboard_source_sans_regular)
  private val bodySemiBoldFont = font(context, R.font.toph_keyboard_source_sans_semibold)

  private val headline =
    TextView(context).apply {
      setTextColor(Palette.textPrimary)
      typeface = displayFont
      maxLines = 1
      accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }

  private val caption =
    TextView(context).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setLineHeightPx(sp(18f))
      maxLines = 2
      ellipsize = TextUtils.TruncateAt.END
      setOnClickListener { if (current?.copy?.tone == CaptionTone.Link) onOpenApp() }
    }

  private val waveform = WaveformView(context)

  val view: View

  private var current: PanelState? = null

  /** Refreshes the clock or the animated dots; one at a time, removed on any other state. */
  private var ticker: Runnable? = null

  init {
    val column =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.START
        addView(headline, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(
          caption,
          LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2f) },
        )
        addView(
          waveform,
          LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8f) },
        )
      }
    val row =
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(16f), dp(12f), dp(16f), 0)
        // The orb's glow reaches past its stage, as on Home; only the panel itself clips.
        clipChildren = false
        clipToPadding = false
        addView(orb, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(
          column,
          LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12f) },
        )
      }
    val hairline = View(context).apply { setBackgroundColor(Palette.lineStrong) }
    val bottomPadding = dp(12f)
    view =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = Backdrop()
        setPadding(0, 0, 0, bottomPadding)
        addView(hairline, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        // Below API 30 keyboards are not drawn edge to edge, so there is no inset to add.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          setOnApplyWindowInsetsListener { root, insets ->
            val navigationBar = insets.getInsets(WindowInsets.Type.navigationBars()).bottom
            root.setPadding(0, 0, 0, bottomPadding + navigationBar)
            insets
          }
        }
        addOnAttachStateChangeListener(
          object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
              current?.let(::startTicker)
            }

            override fun onViewDetachedFromWindow(view: View) {
              stopTicker()
            }
          },
        )
      }
  }

  fun show(state: PanelState) {
    if (state == current) return // a re-render of the same state keeps the clock and dots running
    current = state
    stopTicker()
    orb.show(state.orb, state.orbLabel)
    waveform.show(state.orb == OrbMode.Live)
    showCaption(state.copy)
    showHeadline(state.copy.headline, tick = 0)
    if (view.isAttachedToWindow) startTicker(state)
  }

  private fun showCaption(copy: PanelCopy) {
    caption.text = copy.caption
    caption.setTextColor(
      when (copy.tone) {
        CaptionTone.Muted -> Palette.textTertiary
        CaptionTone.Error -> Palette.accentRed
        CaptionTone.Link -> Palette.accentBlue
      },
    )
    caption.typeface = if (copy.tone == CaptionTone.Link) bodySemiBoldFont else bodyFont
    caption.isClickable = copy.tone == CaptionTone.Link
  }

  /** `tick` counts ticker runs, for the animated dots. */
  private fun showHeadline(headline: Headline, tick: Int) {
    when (headline) {
      is Headline.Text -> {
        this.headline.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        this.headline.letterSpacing = -0.4f / 18f
        this.headline.fontFeatureSettings = null
        this.headline.text = if (headline.animatedDots) withDots(headline.text, tick % 4) else headline.text
      }
      is Headline.Clock -> {
        this.headline.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        this.headline.letterSpacing = -0.6f / 24f
        this.headline.fontFeatureSettings = "tnum"
        this.headline.text = formatClock(SystemClock.elapsedRealtime() - headline.startedAt)
      }
    }
  }

  /** The unshown dots stay in the text, transparent, so the line does not shift as they appear. */
  private fun withDots(text: String, shown: Int): CharSequence {
    val spannable = SpannableString("$text...")
    spannable.setSpan(ForegroundColorSpan(Color.TRANSPARENT), text.length + shown, spannable.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return spannable
  }

  private fun startTicker(state: PanelState) {
    val headline = state.copy.headline
    val interval =
      when {
        headline is Headline.Clock -> CLOCK_TICK_MS
        headline is Headline.Text && headline.animatedDots -> DOTS_TICK_MS
        else -> return
      }
    stopTicker()
    var tick = 0
    val runnable =
      object : Runnable {
        override fun run() {
          tick += 1
          showHeadline(headline, tick)
          this@KeyboardPanel.headline.postDelayed(this, interval)
        }
      }
    ticker = runnable
    this.headline.postDelayed(runnable, interval)
  }

  private fun stopTicker() {
    ticker?.let(headline::removeCallbacks)
    ticker = null
  }

  /** `TextView.setLineHeight` is API 28+; below it, the same spacing through line extra. */
  private fun TextView.setLineHeightPx(lineHeight: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      this.lineHeight = lineHeight
    } else {
      setLineSpacing((lineHeight - paint.getFontMetricsInt(null)).toFloat(), 1f)
    }
  }
}

/** Home's `formatClock` (`src/modules/history/format.ts`): "0:07", "1:42", "12:05". */
private fun formatClock(durationMs: Long): String {
  val totalSeconds = maxOf(0L, durationMs) / 1000
  return "${totalSeconds / 60}:${(totalSeconds % 60).toString().padStart(2, '0')}"
}

private fun font(context: Context, id: Int): Typeface = checkNotNull(ResourcesCompat.getFont(context, id)) { "Missing keyboard font $id" }

/**
 * Home's backdrop (`src/ui/chrome/Backdrop.tsx`), the panel's background; a change to either must
 * be mirrored in the other. The canvas with three faint full-bleed gradients at different angles,
 * each placed by fractions of the panel's size as `expo-linear-gradient` places them.
 */
private class Backdrop : Drawable() {
  private val layers =
    listOf(
      Layer(withAlpha(Palette.accentBlue, 0.09f), withAlpha(Palette.accentBlue, 0f), 0f, 0f, 0.7f, 0.55f),
      Layer(withAlpha(Palette.accentViolet, 0f), withAlpha(Palette.accentViolet, 0.07f), 0.25f, 0.25f, 1f, 0.95f),
      Layer(withAlpha(Palette.accentCyan, 0f), withAlpha(Palette.accentCyan, 0.05f), 0.6f, 0.45f, 0.2f, 1f),
    )

  override fun onBoundsChange(bounds: Rect) {
    val width = bounds.width().toFloat()
    val height = bounds.height().toFloat()
    for (layer in layers) {
      layer.paint.shader =
        LinearGradient(
          bounds.left + layer.startX * width,
          bounds.top + layer.startY * height,
          bounds.left + layer.endX * width,
          bounds.top + layer.endY * height,
          layer.from,
          layer.to,
          Shader.TileMode.CLAMP,
        )
    }
  }

  override fun draw(canvas: Canvas) {
    canvas.drawColor(Palette.canvas)
    for (layer in layers) canvas.drawRect(bounds, layer.paint)
  }

  override fun setAlpha(alpha: Int) = Unit

  override fun setColorFilter(colorFilter: ColorFilter?) = Unit

  @Deprecated("Deprecated in Java")
  override fun getOpacity(): Int = PixelFormat.OPAQUE

  private class Layer(val from: Int, val to: Int, val startX: Float, val startY: Float, val endX: Float, val endY: Float) {
    val paint = Paint()
  }
}
