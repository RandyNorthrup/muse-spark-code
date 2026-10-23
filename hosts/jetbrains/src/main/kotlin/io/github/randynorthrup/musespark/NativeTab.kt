package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.codeInsight.inline.completion.InlineCompletion
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionEventListener
import com.intellij.codeInsight.inline.completion.InlineCompletionEventType
import com.intellij.codeInsight.inline.completion.InlineCompletionInsertEnvironment
import com.intellij.codeInsight.inline.completion.InlineCompletionInsertHandler
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionElement
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.readAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.SwingUtilities
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Service(Service.Level.PROJECT)
class NativeTab(
  private val project: Project,
) {
  @Volatile private var connection: MhpPeer? = null

  @Volatile private var registration: JsonObject? = null

  fun bind(peer: MhpPeer?) {
    connection = peer
    registration = null
  }

  fun register(params: JsonObject) {
    registration = params.deepCopy()
  }

  fun enabled(trigger: String): Boolean {
    val registered = registration ?: return false
    return connection != null && !project.isDisposed &&
      registered["trigger"].asString in setOf(trigger, "both")
  }

  suspend fun complete(request: InlineCompletionRequest): MuseTabOffer? {
    val trigger = if (request.event is InlineCompletionEvent.DirectCall) "invoke" else "automatic"
    val peer = connection?.takeIf { enabled(trigger) } ?: return null
    val snapshot = readAction { context(request, trigger) }
    return snapshot?.let {
      // The runtime owns M94's USD 1/day ledger, capability gate and token/output caps.
      // This adapter never calls a provider or retries a refused completion.
      val pending = peer.request("tab/complete", it)
      val result =
        suspendCancellableCoroutine { continuation ->
          continuation.invokeOnCancellation { pending.cancel(true) }
          pending.whenComplete { value, failure ->
            if (failure == null) continuation.resume(value) else continuation.resumeWithException(failure)
          }
        }
      present(request, peer, it, result.asJsonArray.map { value -> value.asJsonObject })
    }
  }

  private suspend fun present(
    request: InlineCompletionRequest,
    peer: MhpPeer,
    snapshot: JsonObject,
    items: List<JsonObject>,
  ): MuseTabOffer? {
    val current =
      readAction {
        !request.editor.isDisposed && request.document.modificationStamp == snapshot["version"].asLong &&
          request.editor.caretModel.offset == request.startOffset && connection === peer &&
          com.intellij.ide.trustedProjects.TrustedProjects
            .isProjectTrusted(project)
      }
    val position = snapshot["position"]
    val first =
      items.firstOrNull()?.takeIf {
        current && it["text"].asString.isNotEmpty() &&
          it.getAsJsonObject("range")["start"] == position && it.getAsJsonObject("range")["end"] == position
      }
    items.drop(if (first != null) 1 else 0).forEach { peer.notify("tab/rejected", json("id" to it["id"])) }
    return first?.let { MuseTabOffer(it["text"].asString, it["id"], snapshot["uri"].asString, peer) }
  }

  private fun context(
    request: InlineCompletionRequest,
    trigger: String,
  ): JsonObject? {
    val registered = registration
    val file = request.file.virtualFile
    val languages = registered?.getAsJsonArray("languages")?.map { it.asString.lowercase() }.orEmpty()
    val trusted =
      com.intellij.ide.trustedProjects.TrustedProjects
        .isProjectTrusted(project)
    val documents = DocumentServices(project) { trusted }
    val offset = request.startOffset
    val eligible =
      registered != null && file != null && documents.inWorkspace(file) && trusted &&
        (
          request.file.language.id
            .lowercase() in languages || "*" in languages
        ) &&
        offset == request.endOffset && !request.editor.selectionModel.hasSelection()
    return if (eligible) {
      val text = request.document.immutableCharSequence
      json(
        "uri" to DocumentServices.uri(requireNotNull(file)),
        "position" to DocumentServices.position(request.document, offset),
        "version" to request.document.modificationStamp,
        "context" to
          json(
            "prefix" to text.subSequence(0, offset).toString(),
            "suffix" to text.subSequence(offset, text.length).toString(),
            "trigger" to trigger,
          ),
      )
    } else {
      null
    }
  }
}

class MuseInlineCompletionProvider : InlineCompletionProvider {
  private val offers = ConcurrentHashMap<InlineCompletionElement, MuseTabOffer>()
  override val id = InlineCompletionProviderID("muse-spark-code")

  override fun isEnabled(event: InlineCompletionEvent): Boolean {
    val editor =
      when (event) {
        is InlineCompletionEvent.DirectCall -> event.editor
        is InlineCompletionEvent.DocumentChange -> event.editor
        else -> return false
      }
    val trigger = if (event is InlineCompletionEvent.DirectCall) "invoke" else "automatic"
    return editor.project?.getService(NativeTab::class.java)?.enabled(trigger) == true
  }

  override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSuggestion =
    InlineCompletionSingleSuggestion.build(
      elements =
        flow {
          request.editor.project
            ?.getService(NativeTab::class.java)
            ?.complete(request)
            ?.let { offer ->
              val lifetime = JetBrainsPanelHost.onEdt { track(request, offer) }
              if (lifetime != null) {
                emitAll(
                  flowOf(offer.element).onCompletion { failure ->
                    if (failure != null) JetBrainsPanelHost.onEdt { Disposer.dispose(lifetime) }
                  },
                )
              }
            }
        },
    )

  private fun track(
    request: InlineCompletionRequest,
    offer: MuseTabOffer,
  ): Disposable? {
    val project = request.editor.project
    val handler = InlineCompletion.getHandlerOrNull(request.editor)
    return if (handler != null && project != null) {
      val lifetime = Disposer.newDisposable("Muse Tab offer")
      Disposer.register(project, lifetime)
      offers[offer.element] = offer
      Disposer.register(lifetime) {
        // Hide precedes afterInsertion; settle on the next EDT turn.
        SwingUtilities.invokeLater { offers.remove(offer.element)?.reject() }
      }
      handler.addEventListener(
        object : InlineCompletionEventListener {
          override fun on(event: InlineCompletionEventType) {
            if (event is InlineCompletionEventType.Hide) Disposer.dispose(lifetime)
          }
        },
        lifetime,
      )
      lifetime
    } else {
      offer.reject()
      null
    }
  }

  override val insertHandler =
    object : InlineCompletionInsertHandler {
      override fun afterInsertion(
        environment: InlineCompletionInsertEnvironment,
        elements: List<InlineCompletionElement>,
      ) {
        elements.forEach { offers[it]?.accept(environment.editor.document.modificationStamp) }
      }
    }
}

class MuseTabOffer(
  text: String,
  private val completionId: JsonElement,
  private val uri: String,
  private val peer: MhpPeer,
) {
  val element: InlineCompletionElement = InlineCompletionGrayTextElement(text)
  private val settled = AtomicBoolean()

  fun accept(version: Long) {
    if (settled.compareAndSet(false, true)) {
      peer.notify("tab/accepted", json("id" to completionId, "uri" to uri, "version" to version))
    }
  }

  fun reject() {
    if (settled.compareAndSet(false, true)) peer.notify("tab/rejected", json("id" to completionId))
  }
}
