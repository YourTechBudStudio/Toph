package studio.yourtechbud.toph.keyboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.os.SystemClock
import android.view.View
import android.view.inputmethod.EditorInfo

/**
 * Toph Voice, the voice-only keyboard. It owns what the user sees and touches: a mic tap starts a
 * request in [KeyboardDictations], whose JS task records and transcribes; the keyboard only ends
 * the request and shows, inserts or hands off what comes back. No audio, no React Native.
 */
class TophKeyboardService : InputMethodService() {
  private sealed interface Phase {
    data object Idle : Phase

    /** Tapped; waiting for JS to report that capture has started. */
    data class Starting(val requestId: String) : Phase

    /** `startedAt` is `SystemClock.elapsedRealtime()` when capture started, for the clock. */
    data class Recording(val requestId: String, val startedAt: Long) : Phase

    /** `polishing` only changes the wording: transcription is done and polish is running. */
    data class Transcribing(val requestId: String, val polishing: Boolean = false) : Phase
  }

  // At most one request belongs to the keyboard at a time, because a new one starts only from Idle.
  private var phase: Phase = Phase.Idle

  /** The last result's headline and caption, shown while idle until the next recording or until the keyboard leaves the field. */
  private var notice: PanelCopy? = null
  private var panel: KeyboardPanel? = null

  override fun onCreate() {
    super.onCreate()
    KeyboardDictations.prewarm(application)
  }

  /** Also runs again after a configuration change; `render()` restores the current phase. */
  override fun onCreateInputView(): View {
    val created = KeyboardPanel(this, onMic = ::onMicTapped, onOpenApp = ::openApp)
    panel = created
    render()
    return created.view
  }

  /** Shows even when Android thinks a hardware keyboard is attached (the emulator reports one). */
  override fun onEvaluateInputViewShown(): Boolean {
    super.onEvaluateInputViewShown()
    return true
  }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    render() // re-reads the mic permission
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    leaveField()
    super.onFinishInputView(finishingInput)
  }

  override fun onDestroy() {
    leaveField()
    panel = null
    super.onDestroy()
  }

  /**
   * The keyboard leaves this field. A request still starting is cancelled; a recording or transcribing
   * one stops and finishes in the background.
   */
  private fun leaveField() {
    when (val current = phase) {
      is Phase.Starting -> KeyboardDictations.cancel(current.requestId)
      is Phase.Recording -> KeyboardDictations.detach(current.requestId)
      is Phase.Transcribing -> KeyboardDictations.detach(current.requestId)
      Phase.Idle -> Unit
    }
    phase = Phase.Idle
    notice = null
    render()
  }

  private fun onMicTapped() {
    when (val current = phase) {
      Phase.Idle ->
        if (hasMicrophone()) {
          notice = null
          phase = Phase.Starting(KeyboardDictations.start(this))
        } // else: render() below re-checks and keeps showing the mic prompt
      is Phase.Starting -> {
        KeyboardDictations.cancel(current.requestId) // nothing was being heard yet: drop it silently
        phase = Phase.Idle
      }
      is Phase.Recording -> {
        KeyboardDictations.stop(current.requestId)
        phase = Phase.Transcribing(current.requestId)
      }
      is Phase.Transcribing -> Unit // the orb is disabled
    }
    render()
  }

  private fun hasMicrophone() =
    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  /** Opens Toph; its onboarding gate shows whichever step is missing. A keyboard cannot show a permission dialog itself. */
  private fun openApp() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /** Called by [KeyboardDictations.captureStarted], only while this keyboard holds the request. */
  internal fun onCaptureStarted(requestId: String) {
    val current = phase
    if (current !is Phase.Starting || current.requestId != requestId) return // defensive; attached implies Starting
    phase = Phase.Recording(requestId, SystemClock.elapsedRealtime())
    render()
  }

  /** Called by [KeyboardDictations.polishingStarted], only while this keyboard holds the request. */
  internal fun onPolishingStarted(requestId: String) {
    val current = phase
    if (current !is Phase.Transcribing || current.requestId != requestId) return
    phase = current.copy(polishing = true)
    render()
  }

  /**
   * Shows or inserts a result. Called by [KeyboardDictations.deliver], only while this keyboard holds
   * the request and it was not cancelled. False means "not handled here": KeyboardDictations copies
   * and toasts it.
   */
  internal fun onResult(requestId: String, result: KeyboardResult): Boolean {
    if (requestId != currentRequestId()) return false // defensive; attached implies it matches
    phase = Phase.Idle
    if (result is KeyboardResult.Transcript && currentInputConnection?.commitText(result.text, 1) == true) {
      notice = null
      render()
      switchBack()
      return true
    }
    if (result is KeyboardResult.Transcript) {
      notice = null
      render()
      return false // not inserted: KeyboardDictations copies it and toasts only if the copy succeeded
    }
    notice = result.panelCopy()
    render()
    return true
  }

  private fun currentRequestId(): String? =
    when (val current = phase) {
      Phase.Idle -> null
      is Phase.Starting -> current.requestId
      is Phase.Recording -> current.requestId
      is Phase.Transcribing -> current.requestId
    }

  /** Back to the keyboard the user came from. */
  private fun switchBack() {
    if (!switchToPreviousInputMethod()) switchToNextInputMethod(false) // false after `adb ime set`, which records no history
  }

  private fun render() {
    val panel = panel ?: return
    panel.show(
      when (val current = phase) {
        // The missing-mic prompt wins over any notice; both prompts open Toph, so nothing is lost.
        Phase.Idle ->
          if (!hasMicrophone()) {
            PanelState(OrbMode.Rest, PanelCopy.MicMissing)
          } else {
            PanelState(OrbMode.Rest, notice ?: PanelCopy.Idle)
          }
        is Phase.Starting -> PanelState(OrbMode.Rest, PanelCopy.Starting, orbLabel = "Cancel")
        is Phase.Recording -> PanelState(OrbMode.Live, PanelCopy.listening(current.startedAt))
        is Phase.Transcribing ->
          if (current.polishing) {
            PanelState(OrbMode.Busy, PanelCopy.Polishing, orbLabel = "Polishing")
          } else {
            PanelState(OrbMode.Busy, PanelCopy.Transcribing)
          }
      },
    )
  }
}
