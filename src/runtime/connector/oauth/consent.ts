// M124 remote (D240): the page where the person at this PC allows or denies
// one client's sign-in. It is plain HTML with no script and no style of its
// own: a form posts to the interaction, and the browser's own light and
// dark rendering applies. It names the client, the host the browser returns
// to (the profile requires the redirect host to be shown), warns when that
// host is on the client's own computer, lists the permissions, and asks for
// the owner code that this process printed in its terminal: a stranger who
// reaches the page from the network cannot allow anything without it.
import { escapeHtml } from '../../../core/htmlText'
import { fill, UI_TEXT, uiLocale } from '../../../shared/l10n/text'
import { CONNECTOR_REMOTE_PATHS } from '../../../shared/constants'

export interface ConsentView {
  readonly uid: string
  readonly clientName: string
  /** The client's own address, when its id is an address (a metadata document). */
  readonly clientAddress: string | undefined
  /** The host the browser returns to once the person has decided. */
  readonly returnHost: string
  readonly isLoopbackReturn: boolean
  readonly scopes: readonly string[]
  /** Nothing can be allowed: no live grant, or nothing it may be given. */
  readonly isBlocked: boolean
  readonly wrongCode: boolean
}

/** Headers for every page this server renders: no framing, no script, no outside loads. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="${escapeHtml(uiLocale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`
}

export function renderConsentPage(view: ConsentView): string {
  const text = UI_TEXT.acpConnectorRemote
  const scopeItems = view.scopes
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join('')
  const address =
    view.clientAddress === undefined
      ? ''
      : `<p>${escapeHtml(fill(text.consentClientAddress, { address: view.clientAddress }))}</p>`
  const warning = view.isLoopbackReturn
    ? `<p role="note"><strong>${escapeHtml(text.consentLocalWarning)}</strong></p>`
    : ''
  const problemText = view.wrongCode ? text.consentWrongCode : text.consentNoGrant
  const problem =
    view.wrongCode || view.isBlocked ? `<p role="alert">${escapeHtml(problemText)}</p>` : ''
  const allow = view.isBlocked
    ? ''
    : `<p><label for="code">${escapeHtml(text.consentOwnerCode)}</label><br><input id="code" name="code" type="text" required autocomplete="off" spellcheck="false" autocapitalize="characters"></p><button type="submit" name="decision" value="allow">${escapeHtml(text.consentAllow)}</button> `
  return shell(
    text.consentTitle,
    `<h1>${escapeHtml(text.consentTitle)}</h1><p>${escapeHtml(fill(text.consentIntro, { client: view.clientName }))}</p>${address}<p>${escapeHtml(fill(text.consentReturnsTo, { address: view.returnHost }))}</p>${warning}<h2>${escapeHtml(text.consentScopesHeading)}</h2><ul>${scopeItems}</ul>${problem}<form method="post" action="${CONNECTOR_REMOTE_PATHS.interaction}/${encodeURIComponent(view.uid)}">${allow}<button type="submit" name="decision" value="deny" formnovalidate>${escapeHtml(UI_TEXT.acpConnector.deny)}</button></form>`,
  )
}

/** A page that only says something: an expired request, a failed sign-in. */
export function renderMessagePage(title: string, words: string): string {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(words)}</p>`)
}
