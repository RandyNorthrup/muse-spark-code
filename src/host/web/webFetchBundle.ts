// Web fetch as the activation bundle sees it (M69, PLAN.md D6, 2026-10-04):
// dist/webFetch.js, built from webFetchEntry.ts and required on the
// window's first fetch (either backend) or the first URL Muse Code's
// `webFetch` checks. Only types come from the fetch's side here: a value
// imported from there would carry it back into dist/extension.js, which
// the bundle-split gate refuses.
//
// There is no fallback without it: a fetch that cannot load it fails with
// `webFetchUnavailable`, as any refused fetch fails (the log has the cause),
// and the next one tries again.

import type { HtmlConverter } from '../../core/web/htmlConversion'
import type { PageUrlCheck } from '../../core/web/pageUrl'
import type { WebFetcher, WebFetchResult } from '../../core/web/webFetch'
import { MODEL_TEXT, UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as WebFetchEntry from './webFetchEntry'

/** The bundle's exports. */
export interface WebFetchBundle {
  readonly readRawPromptWith: typeof WebFetchEntry.readRawPromptWith
  readonly checkWebPageUrl: typeof WebFetchEntry.checkWebPageUrl
  readonly fetchWebPageWith: typeof WebFetchEntry.fetchWebPageWith
}

/** Whether a required module exports the check and the fetch. */
export function isWebFetchBundle(value: unknown): value is WebFetchBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'checkWebPageUrl' in value &&
    typeof value.checkWebPageUrl === 'function' &&
    'fetchWebPageWith' in value &&
    typeof value.fetchWebPageWith === 'function' &&
    'readRawPromptWith' in value &&
    typeof value.readRawPromptWith === 'function'
  )
}

export interface WebFetchLoaderDeps {
  /** dist/webFetch.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first use and kept from then on. */
export function webFetchLoader(deps: WebFetchLoaderDeps): () => WebFetchBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isWebFetchBundle,
    label: 'web fetch bundle',
    unavailable: () => MODEL_TEXT.webFetchUnavailable,
  })
}

/** A fetch that could not start because the bundle could not be loaded. */
function unavailable(): WebFetchResult {
  return {
    kind: 'failed',
    failure: {
      kind: 'unavailable',
      reason: MODEL_TEXT.webFetchUnavailable,
      visibleReason: UI_TEXT.webFetchUnavailable,
    },
  }
}

/**
 * The window's fetch through the bundle, for the Model API backend's
 * `web_fetch` and Muse Code's `webFetch`: creating it loads nothing.
 */
export function lazyWebFetcher(
  bundle: () => WebFetchBundle,
  log: Logger,
  convertHtml: HtmlConverter,
): WebFetcher {
  return async (url, signal, isStillAllowed) => {
    let loaded: WebFetchBundle
    try {
      loaded = bundle()
    } catch {
      // The loader logged the file and the cause.
      return unavailable()
    }
    return await loaded.fetchWebPageWith(url, signal, isStillAllowed, {
      log,
      convertHtml,
      table: UI_TEXT,
      locale: uiLocale(),
    })
  }
}

/**
 * A URL's first checks through the bundle, before Muse Code's modal; one
 * that cannot be loaded throws `webFetchUnavailable`, which the `ide` server
 * answers as the call's error result.
 */
export function lazyPageUrlCheck(bundle: () => WebFetchBundle): (raw: string) => PageUrlCheck {
  return (raw) => bundle().checkWebPageUrl(raw, UI_TEXT, uiLocale())
}
