// The webview bundle's shared shape (VSIXWEB A): the verified folder or
// the failure to show instead of files. The resolver itself lives in the
// activation bundle (webviewBundleRoot.ts) beside the chat; the lazy panel
// bundles only read this tiny module, so the archive's parser never rides
// them. Panels receive the resolution through a `resolveWebviewBundle`
// callback their host hands in, and show the fixed sentence with its cause
// in the log when the copy is missing, damaged or unwritten — never
// unverified files.
import { WEBVIEW_ARCHIVE_DIR_PREFIX } from '../../shared/constants'

/** The resolver's outcome: the verified folder, or the failure with its cause worded for the log. */
export type WebviewBundleOutcome =
  { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly detail: string }

/**
What the panels show: the verified folder, or the failure with the fixed
sentence already rendered (the activation bundle renders it once, so the
lazy bundles carry no document builder).
*/
export type WebviewBundleResolution =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly detail: string; readonly html: string }

/** Render the failure document onto a failed outcome; a verified folder passes through. */
export function withFailureDocument(
  outcome: WebviewBundleOutcome,
  sentence: string,
  locale: string,
): WebviewBundleResolution {
  return outcome.ok ? outcome : { ...outcome, html: webviewBundleErrorHtml(sentence, locale) }
}

/** The digest-named folder for one archive, beside older digests. */
export function webviewBundleDirName(digest: string): string {
  return `${WEBVIEW_ARCHIVE_DIR_PREFIX}${digest}`
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character)
}

/**
The document a panel shows instead of an unverified bundle: the fixed
sentence, no scripts, no remote origins, so the failure needs no bundle
at all.
*/
export function webviewBundleErrorHtml(sentence: string, locale: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<title>${escapeHtml(sentence)}</title></head>
<body><main><p>${escapeHtml(sentence)}</p></main></body></html>`
}
