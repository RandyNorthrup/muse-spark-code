package io.github.randynorthrup.musespark

import java.net.URI

class AssetPolicy(
  val surface: String,
) {
  val base = "https://muse.invalid/$surface/"
  val page = base + "index.html"

  fun navigationAllowed(url: String): Boolean =
    runCatching {
      val uri = URI(url)
      uri.scheme == "file" && uri.rawAuthority.isNullOrEmpty() && uri.rawQuery == null &&
        NATIVE_HTML_PATH.matches(uri.rawPath.orEmpty()) && uri.rawFragment == "url=$page"
    }.getOrDefault(false)

  fun csp(nonce: String): String =
    "default-src 'none'; script-src 'nonce-$nonce' 'strict-dynamic'; style-src 'unsafe-inline'; " +
      "img-src data: blob:; font-src 'none'; connect-src 'none'; media-src blob:; " +
      "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

  companion object {
    // Captured from the public JBCefBrowser.loadHTML loader on the declared SDK.
    private val NATIVE_HTML_PATH = Regex("/jbcefbrowser/-?[0-9]+")
  }
}
