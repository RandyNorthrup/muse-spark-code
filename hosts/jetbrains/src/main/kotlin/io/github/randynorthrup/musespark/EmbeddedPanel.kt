package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.handler.CefContextMenuHandlerAdapter
import org.cef.handler.CefKeyboardHandler.CefKeyEvent
import org.cef.handler.CefKeyboardHandlerAdapter
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.util.UUID
import javax.swing.JComponent

class EmbeddedPanel(
  val surface: PanelSurface,
  private val boundary: JsonBoundary,
  private val locale: String,
  private val diagnostic: (String) -> Unit,
) : Disposable {
  private val browser: JBCefBrowser
  private val query: JBCefJSQuery
  private val nonce = UUID.randomUUID().toString().replace("-", "")
  private var themeCss = NativeTheme.css()
  private val policy =
    AssetPolicy(surface.id) { path ->
      when (path) {
        "index.html" -> html().toByteArray(Charsets.UTF_8)
        else -> EmbeddedPanel::class.java.getResourceAsStream("/webview/$path")?.use { it.readBytes() }
      }
    }
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
          "ready" -> {
            require(request["value"].isJsonNull)
            surface.subscribe()
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
    installGuards()
    browser.loadURL(policy.page)
  }

  fun deliver(
    payload: JsonElement,
    sequence: Long,
  ) {
    evaluate("window.__museReceive($payload,$sequence)")
  }

  fun reload() {
    surface.reload()
    browser.cefBrowser.reload()
  }

  fun updateTheme() {
    themeCss = NativeTheme.css()
    val encoded = jsonValue(themeCss).toString().replace("<", "\\u003c")
    evaluate("window.__museTheme($encoded,${NativeTheme.dark()})")
  }

  internal fun evaluate(script: String) {
    browser.cefBrowser.executeJavaScript(script, policy.page, 0)
  }

  private fun html(): String {
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
        "\nwindow.installMuseHost($safeConfig,(request,onSuccess,onFailure)=>{$injection});"
    val kind = if (surface.kind in setOf("tasks", "whatsNew")) surface.kind else "chat"
    return JsonBoundary
      .resource("/pages/$kind.$locale.html")
      .replace(
        "__MUSE_ASSET_BASE__",
        policy.base,
      ).replace("__MUSE_NONCE__", nonce)
      .replace("__MUSE_BRIDGE__", safeScript)
      .replace("<body", "<body data-host=\"embedded\"")
      .let { html ->
        if (html.contains("data-surface=")) html else html.replace("<body", "<body data-surface=\"${surface.kind}\"")
      }
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
        ): Boolean = !policy.navigationAllowed(request.url)

        override fun onOpenURLFromTab(
          browser: CefBrowser,
          frame: CefFrame?,
          targetUrl: String,
          userGesture: Boolean,
        ): Boolean = true

        override fun getResourceRequestHandler(
          browser: CefBrowser,
          frame: CefFrame?,
          request: CefRequest,
          isNavigation: Boolean,
          isDownload: Boolean,
          requestInitiator: String?,
          disableDefaultHandling: BoolRef,
        ): CefResourceRequestHandlerAdapter {
          disableDefaultHandling.set(true)
          return object : CefResourceRequestHandlerAdapter() {
            override fun getResourceHandler(
              browser: CefBrowser,
              frame: CefFrame?,
              request: CefRequest,
            ): CefResourceHandlerAdapter = Resource(policy.asset(request.url), policy.csp(nonce))
          }
        }
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
    runCatching(surface::close).onFailure { diagnostic("MHP_PANEL_CLOSE_FAILED") }
    query.dispose()
    browser.dispose()
  }

  private class Resource(
    private val asset: Pair<String, ByteArray>?,
    private val csp: String,
  ) : CefResourceHandlerAdapter() {
    private var offset = 0

    override fun processRequest(
      request: CefRequest,
      callback: CefCallback,
    ): Boolean {
      // Remote JCEF must finish its resource RPC before the continuation RPC.
      com.intellij.openapi.application.ApplicationManager
        .getApplication()
        .executeOnPooledThread { callback.Continue() }
      return true
    }

    override fun getResponseHeaders(
      response: CefResponse,
      responseLength: IntRef,
      redirectUrl: StringRef,
    ) {
      response.status = if (asset == null) HTTP_NOT_FOUND else HTTP_OK
      response.mimeType = asset?.first ?: "text/plain"
      response.setHeaderByName("Content-Security-Policy", csp, true)
      response.setHeaderByName("X-Content-Type-Options", "nosniff", true)
      response.setHeaderByName("Cache-Control", "no-store", true)
      responseLength.set(asset?.second?.size ?: 0)
    }

    override fun readResponse(
      dataOut: ByteArray,
      bytesToRead: Int,
      bytesRead: IntRef,
      callback: CefCallback,
    ): Boolean {
      val bytes = asset?.second ?: return false
      val count = minOf(bytesToRead, bytes.size - offset)
      bytes.copyInto(dataOut, 0, offset, offset + count)
      offset += count
      bytesRead.set(count)
      return count > 0
    }
  }

  companion object {
    private const val HTTP_OK = 200
    private const val HTTP_NOT_FOUND = 404
    private const val CTRL_SHIFT = 6
    private val DEVTOOLS_KEYS =
      setOf(java.awt.event.KeyEvent.VK_I, java.awt.event.KeyEvent.VK_J, java.awt.event.KeyEvent.VK_C)
  }
}
