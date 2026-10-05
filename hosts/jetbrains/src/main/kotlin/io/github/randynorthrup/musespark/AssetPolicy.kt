package io.github.randynorthrup.musespark

import java.net.URI

class AssetPolicy(
  val surface: String,
  private val load: (String) -> ByteArray?,
) {
  val base = "https://muse.invalid/$surface/"
  val page = base + "index.html"

  fun navigationAllowed(url: String): Boolean =
    runCatching {
      val uri = URI(url)
      localOrigin(uri) &&
        uri.rawPath == "/$surface/index.html" && uri.rawQuery == null
    }.getOrDefault(false)

  fun asset(url: String): Pair<String, ByteArray>? {
    val path = runCatching { URI(url) }.getOrNull()?.let(::localPath) ?: return null
    val type = mimeType(path)
    return type?.let { load(path)?.let { bytes -> it to bytes } }
  }

  private fun localOrigin(uri: URI): Boolean =
    uri.scheme == "https" && uri.host == "muse.invalid" && uri.port == -1 && uri.rawUserInfo == null

  private fun localPath(uri: URI): String? {
    val sameOrigin = localOrigin(uri) && uri.rawQuery == null && uri.rawFragment == null
    val path = uri.rawPath?.takeIf { it.startsWith("/$surface/") }?.removePrefix("/$surface/")
    return path?.takeIf {
      sameOrigin && ASSET_PATH.matches(it) &&
        it.split('/').none { part -> part == "." || part == ".." }
    }
  }

  private fun mimeType(path: String): String? =
    when {
      path.endsWith(".js") -> "text/javascript"
      path.endsWith(".css") -> "text/css"
      path.endsWith(".woff2") -> "font/woff2"
      path == "index.html" -> "text/html"
      else -> null
    }

  fun csp(nonce: String): String =
    "default-src 'none'; script-src 'nonce-$nonce' $base; " +
      "style-src $base 'unsafe-inline'; img-src data: blob:; font-src $base; connect-src 'none'; " +
      "media-src blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

  companion object {
    private val ASSET_PATH = Regex("[a-zA-Z0-9_./-]+")
  }
}
