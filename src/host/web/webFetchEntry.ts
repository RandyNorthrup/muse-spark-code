// Web fetch's shipped CommonJS bundle (M69, PLAN.md D6, 2026-10-04): the
// fetch itself (each hop resolved, checked and pinned, the pinned HTTPS
// transport, the decoders) and the words of its failures. esbuild builds
// this file into dist/webFetch.js, which `webFetchLoader` requires on the
// window's first fetch or the first URL Muse Code's `webFetch` checks, so
// none of it is in the bundle VS Code loads at activation; HTML is still
// converted on dist/pageWorker.js, which activation starts for each page.
// The Model API backend (its own URL checks) and the ACP agent keep their
// own copies. Each call receives the installed display table.

import type { HtmlConverter } from '../../core/web/htmlConversion'
import { checkPageUrl, type PageUrlCheck } from '../../core/web/pageUrl'
import type { WebFetchResult } from '../../core/web/webFetch'
import type { UiText } from '../../shared/l10n/en'

// M91 HTTP hooks reuse this lazy transport bundle and its pinned-request path.
export { postHookPayload } from './hookHttpRequest'
import { setUiText } from '../../shared/l10n/text'
import type { Logger } from '../logger'
import { createWebFetcher } from './webFetcher'

/** What one fetch needs from the activation bundle. */
export interface WebFetchCall {
  readonly log: Logger
  /** HTML to Markdown on a worker of its own (pageConverter.ts). */
  readonly convertHtml: HtmlConverter
  readonly table: UiText
  readonly locale: string
}

/** A URL's first checks, before any approval (pageUrl.ts), in the installed language. */
export function checkWebPageUrl(raw: string, table: UiText, locale: string): PageUrlCheck {
  setUiText(table, locale)
  return checkPageUrl(raw)
}

/** One fetch, as the window's fetcher makes it (webFetcher.ts). */
export async function fetchWebPageWith(
  url: string,
  signal: AbortSignal,
  isStillAllowed: (() => boolean) | undefined,
  call: WebFetchCall,
): Promise<WebFetchResult> {
  setUiText(call.table, call.locale)
  return await createWebFetcher(call.log, call.convertHtml)(url, signal, isStillAllowed)
}
