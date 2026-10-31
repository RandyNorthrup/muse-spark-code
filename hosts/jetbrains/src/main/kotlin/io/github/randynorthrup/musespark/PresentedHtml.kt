package io.github.randynorthrup.musespark

/**
 * Peer HTML is a document the runtime asks the surface to show. It is not a
 * navigation request and it does not choose the page policy: scripts, frames,
 * foreign content-security policies and event handlers are removed before the
 * host installs its own policy and bridge.
 */
internal object PresentedHtml {
  private val script = Regex("(?is)<script\\b[^>]*>.*?</script\\s*>")
  private val scriptOpen = Regex("(?i)<script\\b")
  private val cspMeta =
    Regex("(?i)<meta\\b[^>]*http-equiv\\s*=\\s*[\"']?content-security-policy[\"']?[^>]*>")
  private val refresh =
    Regex("(?i)<meta\\b[^>]*http-equiv\\s*=\\s*[\"']?refresh[\"']?[^>]*>")
  private val framed = Regex("(?is)<(?:iframe|object|embed|base)\\b[^>]*(?:>.*?</(?:iframe|object|embed|base)\\s*>|/?>)")
  private val link = Regex("(?is)<link\\b[^>]*>")
  private val handler = Regex("(?i)\\s+on[a-z]+\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)")
  private val scriptUrl = Regex("(?i)(\\s(?:href|src|action)\\s*=\\s*)(?:([\"'])\\s*javascript:[^\"']*\\2|javascript:[^\\s>]*)")

  fun admit(html: String): String {
    var document = script.replace(html, "")
    if (scriptOpen.containsMatchIn(document)) throw IllegalArgumentException("MHP_INVALID_HTML")
    document = cspMeta.replace(document, "")
    document = refresh.replace(document, "")
    document = framed.replace(document, "")
    document = link.replace(document, "")
    document = handler.replace(document, "")
    document = scriptUrl.replace(document) { match -> match.groupValues[1] + "\"\"" }
    if (!Regex("(?i)</head>").containsMatchIn(document)) throw IllegalArgumentException("MHP_INVALID_HTML")
    return document
  }

  /** One host policy, even when the peer document arrived with none. */
  fun seal(
    html: String,
    csp: String,
  ): String {
    val meta = "<meta http-equiv=\"Content-Security-Policy\" content=\"$csp\">"
    val stripped = cspMeta.replace(html, "")
    if (!Regex("(?i)<head>").containsMatchIn(stripped)) throw IllegalArgumentException("MHP_INVALID_HTML")
    return stripped.replaceFirst(Regex("(?i)<head>"), "<head>$meta")
  }
}
