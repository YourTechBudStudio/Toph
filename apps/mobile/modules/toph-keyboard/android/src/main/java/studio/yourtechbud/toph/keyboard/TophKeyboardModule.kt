package studio.yourtechbud.toph.keyboard

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `deliver`'s argument, as JS's `KeyboardResult`. */
class KeyboardResultRecord : Record {
  @Field val kind: String = ""

  @Field val text: String? = null

  @Field val message: String? = null

  internal fun toResult(): KeyboardResult =
    when (kind) {
      "transcript" -> KeyboardResult.Transcript(text.orEmpty())
      "no_speech" -> KeyboardResult.NoSpeech
      "failed" -> KeyboardResult.Failed(message.orEmpty())
      "no_provider" -> KeyboardResult.NoProvider
      else -> KeyboardResult.Failed("Unexpected result \"$kind\".")
    }
}

/** The JS surface of the voice keyboard. `modules/toph-keyboard/index.ts` documents the contract. */
class TophKeyboardModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TophKeyboard")

    Function("isEnabled") {
      val keyboard = ComponentName(context, TophKeyboardService::class.java)
      context.getSystemService(InputMethodManager::class.java).enabledInputMethodList.any { it.component == keyboard }
    }

    Function("openSettings") {
      context.startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // On the main queue, so KeyboardDictations stays single-threaded.
    AsyncFunction("hasStopped") { requestId: String -> KeyboardDictations.hasStopped(requestId) }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("captureStarted") { requestId: String -> KeyboardDictations.captureStarted(requestId) }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("polishingStarted") { requestId: String -> KeyboardDictations.polishingStarted(requestId) }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("waitForStop") { requestId: String, promise: Promise -> KeyboardDictations.waitForStop(requestId, promise) }
      .runOnQueue(Queues.MAIN)

    // Synchronous on the main queue, so the promise resolves only after native has handled the result.
    AsyncFunction("deliver") { requestId: String, result: KeyboardResultRecord ->
      KeyboardDictations.deliver(requestId, result.toResult())
    }.runOnQueue(Queues.MAIN)
  }
}
