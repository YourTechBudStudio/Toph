package studio.yourtechbud.toph.keyboard

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import android.widget.Toast
import androidx.annotation.MainThread
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.Promise
import java.util.UUID

internal const val TAG = "TophKeyboard"

/** Must match KEYBOARD_DICTATION_TASK in modules/toph-keyboard/index.ts. */
private const val TASK = "TophKeyboardDictation"

/** A request's result, as JS's `KeyboardResult` in `modules/toph-keyboard/index.ts`. */
internal sealed interface KeyboardResult {
  data class Transcript(val text: String) : KeyboardResult

  data object NoSpeech : KeyboardResult

  data class Failed(val message: String) : KeyboardResult

  data object NoProvider : KeyboardResult
}

/** The one line shown on the keyboard, or toasted, for a result that was not inserted. */
internal fun KeyboardResult.notice(): String =
  when (this) {
    is KeyboardResult.Transcript -> "Transcript copied" // it went to the clipboard
    KeyboardResult.NoSpeech -> "Didn't catch that"
    is KeyboardResult.Failed -> message
    KeyboardResult.NoProvider -> "Connect a provider in Toph"
  }

/** The headline and caption the keyboard shows for a result it did not insert. */
internal fun KeyboardResult.panelCopy(): PanelCopy =
  when (this) {
    is KeyboardResult.Transcript -> PanelCopy.Idle // not reached: an uninserted transcript is copied, not shown
    KeyboardResult.NoSpeech -> PanelCopy(Headline.Text("Didn't catch that."), "No speech came through. Tap the orb to try again.")
    is KeyboardResult.Failed -> PanelCopy(Headline.Text("That didn't work."), message, CaptionTone.Error)
    KeyboardResult.NoProvider -> PanelCopy(Headline.Text("No provider yet"), "Connect a provider in Toph ›", CaptionTone.Link)
  }

/** The JS name of a result's kind, for logs. Never the transcript text. */
private val KeyboardResult.kind: String
  get() =
    when (this) {
      is KeyboardResult.Transcript -> "transcript"
      KeyboardResult.NoSpeech -> "no_speech"
      is KeyboardResult.Failed -> "failed"
      KeyboardResult.NoProvider -> "no_provider"
    }

/**
 * Every open keyboard request, process-wide, including those whose keyboard has already gone. A
 * request lives from the mic tap until JS delivers its result, and only `deliver` removes it.
 *
 * Everything here runs on the main thread: the service's callbacks, React Native's instance
 * listener, and the Expo functions, which run on the main queue. So plain collections, no locks.
 */
internal object KeyboardDictations {
  private class Request(
    val id: String,
    /** For clipboard and toast after the keyboard is gone. */
    val appContext: Context,
    /** The keyboard showing this request; null once detached. */
    var keyboard: TophKeyboardService?,
  ) {
    var stopped = false

    /** Ended while the keyboard still said "Starting…": the result is dropped, never shown or copied. */
    var cancelled = false
    var stopWaiter: Promise? = null
  }

  private val requests = HashMap<String, Request>()

  /** Requests whose task is not started yet because the React instance does not exist yet. */
  private val undispatched = ArrayList<String>()
  private var awaitingInstance = false

  /** Starts React Native ahead of the first tap, so the first dictation does not wait for it. */
  @MainThread
  fun prewarm(application: Application) {
    reactHost(application).start()
  }

  /** Opens a request for `keyboard` and starts its task as soon as JS can run it. */
  @MainThread
  fun start(keyboard: TophKeyboardService): String {
    val id = UUID.randomUUID().toString()
    requests[id] = Request(id, keyboard.applicationContext, keyboard)
    undispatched += id
    val ready = activeContext(reactHost(keyboard.application)) != null
    Log.i(TAG, "request $id started (${if (ready) "instance ready" else "waiting for the React instance"})")
    dispatchWhenReady(keyboard.application)
    return id
  }

  /** The keyboard ended the recording: JS stops capture and transcribes. */
  @MainThread
  fun stop(id: String) {
    val request = requests[id] ?: return
    if (request.stopped) return
    request.stopped = true
    request.stopWaiter?.resolve()
    request.stopWaiter = null
    Log.i(TAG, "request $id stopped")
  }

  /** The keyboard left the field: the request stops and its result goes to the clipboard or a toast. */
  @MainThread
  fun detach(id: String) {
    val request = requests[id] ?: return
    stop(id)
    request.keyboard = null
    Log.i(TAG, "request $id detached")
  }

  /** Ended before capture started: the request stops and its result is dropped. */
  @MainThread
  fun cancel(id: String) {
    val request = requests[id] ?: return
    detach(id)
    request.cancelled = true
    Log.i(TAG, "request $id cancelled")
  }

  /** An unknown request counts as ended. */
  @MainThread
  fun hasStopped(id: String): Boolean = requests[id]?.stopped ?: true

  @MainThread
  fun captureStarted(id: String) {
    val request = requests[id] ?: return
    Log.i(TAG, "request $id capture started")
    request.keyboard?.onCaptureStarted(id) // null when detached or cancelled: nothing to show
  }

  /** Transcription is done and polish is running; only the wording changes. */
  @MainThread
  fun polishingStarted(id: String) {
    val request = requests[id] ?: return // unknown or already delivered
    Log.i(TAG, "request $id polishing started")
    request.keyboard?.onPolishingStarted(id) // null when detached or cancelled: nothing to show
  }

  /** Resolves `promise` when the request is stopped, or at once if it already is (or is unknown). */
  @MainThread
  fun waitForStop(id: String, promise: Promise) {
    val request = requests[id]
    if (request == null || request.stopped) {
      promise.resolve()
      return
    }
    request.stopWaiter = promise
  }

  /** Inserts or shows the result on the keyboard that still holds the request, else copies and toasts it. */
  @MainThread
  fun deliver(id: String, result: KeyboardResult) {
    val request = requests.remove(id)
    if (request == null) {
      Log.w(TAG, "deliver for unknown request $id ignored")
      return
    }
    if (request.cancelled) {
      Log.i(TAG, "request $id delivered ${result.kind} (dropped)")
      return
    }
    val shown = request.keyboard?.onResult(id, result) == true
    if (shown) {
      Log.i(TAG, "request $id delivered ${result.kind} (${if (result is KeyboardResult.Transcript) "inserted" else "shown"})")
      return
    }
    deliverInBackground(request.appContext, result)
    Log.i(TAG, "request $id delivered ${result.kind} (background)")
  }

  private fun deliverInBackground(context: Context, result: KeyboardResult) {
    if (result is KeyboardResult.Transcript) {
      try {
        context
          .getSystemService(ClipboardManager::class.java)
          .setPrimaryClip(ClipData.newPlainText("Toph transcript", result.text))
      } catch (error: RuntimeException) {
        Log.w(TAG, "could not copy the transcript", error)
        return // never toast "Transcript copied" for a copy that failed
      }
    }
    // Android drops this silently without POST_NOTIFICATIONS; the clipboard still holds the transcript.
    Toast.makeText(context, result.notice(), Toast.LENGTH_SHORT).show()
  }

  private fun dispatchWhenReady(application: Application) {
    val host = reactHost(application)
    val context = activeContext(host)
    if (context != null) {
      dispatch(context)
      return
    }
    if (!awaitingInstance) {
      awaitingInstance = true
      host.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this) // the host's list is copy-on-write
            awaitingInstance = false
            dispatch(context)
          }
        },
      )
    }
    host.start() // joins a start already in progress, such as the pre-warm
  }

  /** A context exists before its React instance, and `startTask` only logs a soft exception without one. */
  private fun activeContext(host: ReactHost): ReactContext? =
    host.currentReactContext?.takeIf { it.hasActiveReactInstance() }

  /** Stopped, detached and cancelled requests are dispatched too: only the task's `deliver` removes them. */
  private fun dispatch(context: ReactContext) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    for (id in undispatched) {
      val data = Arguments.createMap().apply { putString("requestId", id) }
      // Timeout 0: the task lives until JS delivers. Allowed in the foreground: Toph itself may be in front.
      tasks.startTask(HeadlessJsTaskConfig(TASK, data, 0, true))
      Log.i(TAG, "request $id dispatched")
    }
    undispatched.clear()
  }

  private fun reactHost(application: Application): ReactHost =
    checkNotNull((application as ReactApplication).reactHost) { "Toph runs on the New Architecture, which always has a React host." }
}
