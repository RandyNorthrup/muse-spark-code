package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefContextMenuHandlerAdapter
import org.cef.handler.CefKeyboardHandler.CefKeyEvent
import org.cef.handler.CefKeyboardHandlerAdapter
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.network.CefRequest
import java.util.UUID
import javax.swing.JComponent

class EmbeddedPanel(
  val surface: PanelSurface,
  private val boundary: JsonBoundary,
  private val locale: String,
  private val diagnostic: (String) -> Unit,
  private val unavailable: (() -> Unit)? = null,
) : Disposable {
  private val browser: JBCefBrowser
  private val query: JBCefJSQuery
  private val nonce = UUID.randomUUID().toString().replace("-", "")
  private var themeCss = NativeTheme.css()
  private val subscribed =
    java.util.concurrent.atomic
      .AtomicBoolean()
  private val readiness =
    javax.swing
      .Timer(READINESS_MILLIS) {
        if (!subscribed.get()) {
          diagnostic("MHP_JCEF_NOT_READY")
          unavailable?.invoke()
        }
      }.apply { isRepeats = false }
  private val policy = AssetPolicy("$nonce/${surface.id}")
  val component: JComponent get() = browser.component

  init {
    require(JBCefApp.isSupported()) { "MHP_JCEF_UNSUPPORTED" }
    browser = JBCefBrowser()
    val queryBrowser: com.intellij.ui.jcef.JBCefBrowserBase = browser
    query = JBCefJSQuery.create(queryBrowser)
    query.addHandler { text ->
      try {
        require(text.toByteArray(Charsets.UTF_8).size <= boundary.maximumFrameBytes) { "MHP_PANEL_TOO_LARGE" }
        val request = JsonBoundary.parse(text).asJsonObject
        require(request.keySet() == setOf("operation", "value")) { "MHP_INVALID_REQUEST" }
        when (request["operation"].asString) {
          "module" -> {
            val requested = request["value"].asString
            val manifest = JsonBoundary.parse(JsonBoundary.resource("/webview/portable/modules.json")).asJsonObject
            val module =
              manifest
                .getAsJsonArray(
                  "modules",
                ).singleOrNull { it.asJsonObject["path"].asString == requested }
            requireNotNull(module) { "MHP_MODULE_UNLISTED" }
            require(Regex("/assets/portable/(?:chunks/)?[\\w.-]+\\.js").matches(requested)) { "MHP_MODULE_UNLISTED" }
            val source = JsonBoundary.resource("/webview/portable/" + requested.removePrefix("/assets/portable/"))
            require(source.toByteArray(Charsets.UTF_8).size <= boundary.maximumFrameBytes) { "MHP_PANEL_TOO_LARGE" }
            return@addHandler JBCefJSQuery.Response(source)
          }
          "ready" -> {
            require(request["value"].isJsonNull)
            surface.subscribe()
            subscribed.set(true)
            readiness.stop()
          }
          "post" -> {
            val payload = request["value"]
            boundary.payload(surface.kind, "toHost", payload)
            if (payload.asJsonObject["type"]?.asString == "hostAction" &&
              payload.asJsonObject["action"]?.asString == "reload"
            ) {
              reload()
            } else {
              surface.post(payload)
            }
          }
          "state" -> surface.savedState = request["value"]
          "delivered" -> {
            val value = request["value"]
            require(
              value.isJsonPrimitive && value.asJsonPrimitive.isNumber &&
                value.asBigDecimal.stripTrailingZeros().scale() <= 0,
            ) { "MHP_INVALID_REQUEST" }
            surface.delivered(value.asLong)
          }
          else -> error("MHP_INVALID_REQUEST")
        }
        JBCefJSQuery.Response("")
      } catch (_: Exception) {
        diagnostic("MHP_PANEL_BRIDGE_REFUSED")
        JBCefJSQuery.Response(null, 1, "MHP_PANEL_BRIDGE_REFUSED")
      }
    }
    runCatching {
      installGuards()
      browser.loadHTML(prepareHtml(), policy.page)
      readiness.start()
    }.onFailure {
      query.dispose()
      browser.dispose()
    }.getOrThrow()
  }

  fun deliver(
    payload: JsonElement,
    sequence: Long,
  ) {
    evaluate("window.__museReceive($payload,$sequence)")
  }

  fun present(html: String) {
    browser.loadHTML(prepareHtml(html), policy.page)
  }

  fun reload() {
    surface.reload()
    subscribed.set(false)
    readiness.restart()
    browser.loadHTML(prepareHtml(), policy.page)
  }

  fun updateTheme() {
    themeCss = NativeTheme.css()
    val encoded = jsonValue(themeCss).toString().replace("<", "\\u003c")
    evaluate("window.__museTheme($encoded,${NativeTheme.dark()})")
  }

  internal fun evaluate(script: String) {
    browser.cefBrowser.executeJavaScript(script, policy.page, 0)
  }

  private fun prepareHtml(source: String? = null): String {
    val kind = if (surface.kind in setOf("tasks", "whatsNew")) surface.kind else "chat"
    val html = source ?: JsonBoundary.resource("/pages/$kind.$locale.html")
    val envelope = boundary.panel.getAsJsonObject("envelope")
    val payloads =
      envelope.getAsJsonArray("oneOf").map {
        it.asJsonObject
          .getAsJsonObject("properties")["payload"]
          .asJsonObject["anyOf"]
          .asJsonArray
      }
    val index =
      when (surface.kind) {
        "tasks" -> 1
        "whatsNew" -> 2
        else -> 0
      }
    val config =
      json(
        "toHost" to payloads[0][index],
        "toPanel" to (payloads[1].toList().getOrNull(index) ?: jsonValue(false)),
        "stateSchema" to
          JsonBoundary
            .parse(JsonBoundary.resource("/mhp/mhp-v1.1.schema.json"))
            .asJsonObject
            .getAsJsonObject("embeddedBridge")
            .getAsJsonObject("setState")["state"],
        "limits" to boundary.panel["limits"],
        "themeCss" to themeCss,
        "nonce" to nonce,
        "dark" to NativeTheme.dark(),
      )
    surface.savedState?.let { config.add("state", it) }
    val injection = query.inject("request", "onSuccess", "onFailure")
    val safeConfig = config.toString().replace("<", "\\u003c")
    val safeScript =
      JsonBoundary.resource("/embedded.mjs") +
        "\nwindow.installMuseHost($safeConfig,(request,onSuccess,onFailure)=>{$injection});" + moduleBridge(injection)
    return html
      .replace(
        "__MUSE_ASSET_BASE__",
        policy.base,
      ).replace("__MUSE_NONCE__", nonce)
      .replace("__MUSE_BRIDGE__", safeScript)
      .let { page ->
        if (html.contains("__MUSE_BRIDGE__")) {
          page
        } else {
          page.replace("</head>", "<script nonce=\"$nonce\">$safeScript</script></head>")
        }
      }.replace(Regex("nonce=\"[^\"]*\""), "nonce=\"$nonce\"")
      .replace("<body", "<body data-host=\"embedded\"")
      .let { inlineAssets(it, kind) }
      .let { html ->
        if (html.contains("data-surface=")) html else html.replace("<body", "<body data-surface=\"${surface.kind}\"")
      }
  }

  private fun moduleBridge(injection: String): String {
    val manifest = JsonBoundary.resource("/webview/portable/modules.json").replace("<", "\\u003c")
    return if (surface.kind == "whatsNew") {
      ""
    } else {
      JsonBoundary.resource("/nativeModules.mjs") +
        "\nwindow.installMuseModules($manifest,(path,onSuccess,onFailure)=>{" +
        "const request=JSON.stringify({operation:'module',value:path});$injection})" +
        ".catch(()=>{document.documentElement.dataset.launch='failed'});"
    }
  }

  private fun inlineAssets(
    html: String,
    kind: String,
  ): String {
    val entry = if (kind == "whatsNew") "whatsNew" else "main"
    val script =
      if (entry == "main") {
        ""
      } else {
        JsonBoundary.resource("/pages/$entry.inline.js").replace("</script", "<\\/script", ignoreCase = true)
      }
    val style = JsonBoundary.resource(if (entry == "main") "/webview/portable/main.css" else "/webview/$entry.css")
    return html
      .replace(
        Regex("<meta http-equiv=\"Content-Security-Policy\"[^>]*>"),
        { "<meta http-equiv=\"Content-Security-Policy\" content=\"${policy.csp(nonce)}\">" },
      ).replace(Regex("<link[^>]*rel=\"stylesheet\"[^>]*>"), { "<style nonce=\"$nonce\">$style</style>" })
      .replace(Regex("<script[^>]*src=\"([^\"]+)\"[^>]*></script>"), { match ->
        // The native module bridge loads chat/Tasks. What's New's entry is inline;
        // its companion loader must not run a second copy or fetch native URLs.
        if (entry == "whatsNew" &&
          match.groupValues[1].endsWith("/whatsNew.js")
        ) {
          "<script nonce=\"$nonce\">$script</script>"
        } else {
          ""
        }
      })
  }

  private fun installGuards() {
    val client = browser.jbCefClient
    val cef = browser.cefBrowser
    client.addRequestHandler(
      object : CefRequestHandlerAdapter() {
        override fun onBeforeBrowse(
          browser: CefBrowser,
          frame: CefFrame?,
          request: CefRequest,
          userGesture: Boolean,
          isRedirect: Boolean,
        ): Boolean {
          val allowed = policy.navigationAllowed(request.url)
          if (!allowed) diagnostic("MHP_BROWSER_NAVIGATION_REFUSED")
          return !allowed
        }

        override fun onOpenURLFromTab(
          browser: CefBrowser,
          frame: CefFrame?,
          targetUrl: String,
          userGesture: Boolean,
        ): Boolean = true
      },
      cef,
    )
    client.addLifeSpanHandler(
      object : CefLifeSpanHandlerAdapter() {
        override fun onBeforePopup(
          browser: CefBrowser,
          frame: CefFrame?,
          targetUrl: String,
          targetFrameName: String,
        ): Boolean = true
      },
      cef,
    )
    client.addContextMenuHandler(
      object : CefContextMenuHandlerAdapter() {
        override fun onBeforeContextMenu(
          browser: CefBrowser,
          frame: CefFrame?,
          params: org.cef.callback.CefContextMenuParams,
          model: org.cef.callback.CefMenuModel,
        ) {
          model.clear()
        }
      },
      cef,
    )
    client.addKeyboardHandler(
      object : CefKeyboardHandlerAdapter() {
        override fun onPreKeyEvent(
          browser: CefBrowser,
          event: CefKeyEvent,
          isKeyboardShortcut: BoolRef,
        ): Boolean =
          event.windows_key_code == java.awt.event.KeyEvent.VK_F12 ||
            ((event.modifiers and CTRL_SHIFT) == CTRL_SHIFT && event.windows_key_code in DEVTOOLS_KEYS)
      },
      cef,
    )
  }

  override fun dispose() {
    readiness.stop()
    runCatching(surface::close).onFailure { diagnostic("MHP_PANEL_CLOSE_FAILED") }
    query.dispose()
    browser.dispose()
  }

  companion object {
    private const val READINESS_MILLIS = 15_000
    private const val CTRL_SHIFT = 6
    private val DEVTOOLS_KEYS =
      setOf(java.awt.event.KeyEvent.VK_I, java.awt.event.KeyEvent.VK_J, java.awt.event.KeyEvent.VK_C)
  }
}
