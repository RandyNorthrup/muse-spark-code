package io.github.randynorthrup.musespark

import com.intellij.openapi.Disposable
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import java.util.concurrent.CompletableFuture

/** Reads one fact from the loaded page; the conformance suite looks at what the person sees. */
internal class PageInspector(
  browser: JBCefBrowserBase,
  private val evaluate: (String) -> Unit,
) : Disposable {
  private val query = JBCefJSQuery.create(browser)

  @Volatile private var pending: CompletableFuture<String>? = null

  init {
    query.addHandler { text ->
      pending?.complete(text)
      JBCefJSQuery.Response("")
    }
  }

  fun inspect(script: String): CompletableFuture<String> {
    val future = CompletableFuture<String>()
    synchronized(this) {
      val previous = pending
      check(previous == null || previous.isDone) { "MHP_PANEL_INSPECTION_PENDING" }
      pending = future
    }
    evaluate(query.inject("String(($script))"))
    return future
  }

  override fun dispose() = query.dispose()
}
