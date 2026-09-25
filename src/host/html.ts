// Builds the webview document. Pure: no `vscode` import, so it is unit-tested
// directly. Security properties (PLAN.md section 2, D4):
//   - default-src 'none'; scripts only with the per-load nonce; no remote
//     origins; no 'unsafe-inline' / 'unsafe-eval' anywhere.
//   - Inline `style=` attributes are blocked by this policy on purpose, so the
//     React tree must style through classes in main.css.
//   - The display language's table rides in a `type="application/json"`
//     script (D33): a data block the browser never runs, so the policy needs
//     no change for it. The webview reads it before its first render.

import {
  NONCE_BYTES,
  PRODUCT_NAME,
  WEBVIEW_L10N_ELEMENT_ID,
  WEBVIEW_ROOT_ELEMENT_ID,
} from '../shared/constants'
import type { UiTable } from './l10n'

export interface WebviewHtmlOptions {
  readonly scriptUri: string
  readonly styleUri: string
  /** `webview.cspSource`: the origin VS Code serves local resources from. */
  readonly cspSource: string
  readonly nonce: string
  /** The installed table and its language (`<html lang>` for screen readers). */
  readonly l10n: UiTable
}

// What must not appear raw inside a script element: `<` could close it
// (`</script>`) or open a comment, and the two line separators end a line
// in older JavaScript parsers. Each becomes its JSON escape, which parses
// back to the same text.
const SCRIPT_UNSAFE = /[<\u{2028}\u{2029}]/gu
const SCRIPT_ESCAPES: Readonly<Record<string, string>> = {
  '<': String.raw`\u003c`,
  '\u{2028}': String.raw`\u2028`,
  '\u{2029}': String.raw`\u2029`,
}

export function createNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return Buffer.from(bytes).toString('base64url')
}

/** JSON that is safe as the text of a `<script>` element. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    SCRIPT_UNSAFE,
    (character) => SCRIPT_ESCAPES[character] ?? character,
  )
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${options.cspSource} data:`,
    `style-src ${options.cspSource} 'nonce-${options.nonce}'`,
    `font-src ${options.cspSource}`,
    `script-src 'nonce-${options.nonce}'`,
  ].join('; ')
  const { locale, table } = options.l10n

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${options.styleUri}" nonce="${options.nonce}">
<title>${PRODUCT_NAME}</title>
</head>
<body>
<div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div>
<script type="application/json" id="${WEBVIEW_L10N_ELEMENT_ID}">${scriptSafeJson({ locale, table })}</script>
<script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>
`
}
