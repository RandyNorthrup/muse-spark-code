// Builds the webview document. Pure: no `vscode` import, so it is unit-tested
// directly. Security properties (PLAN.md section 2, D4):
//   - default-src 'none'; scripts only with the per-load nonce; no remote
//     origins; no 'unsafe-inline' / 'unsafe-eval' anywhere.
//   - Inline `style=` attributes are blocked by this policy on purpose, so the
//     React tree must style through classes in main.css.

import { NONCE_BYTES, PRODUCT_NAME, WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'

export interface WebviewHtmlOptions {
  readonly scriptUri: string
  readonly styleUri: string
  /** `webview.cspSource`: the origin VS Code serves local resources from. */
  readonly cspSource: string
  readonly nonce: string
}

export function createNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return Buffer.from(bytes).toString('base64url')
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${options.cspSource} data:`,
    `style-src ${options.cspSource} 'nonce-${options.nonce}'`,
    `font-src ${options.cspSource}`,
    `script-src 'nonce-${options.nonce}'`,
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${options.styleUri}" nonce="${options.nonce}">
<title>${PRODUCT_NAME}</title>
</head>
<body>
<div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div>
<script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>
`
}
