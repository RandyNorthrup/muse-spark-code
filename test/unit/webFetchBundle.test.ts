// Web fetch's own bundle (M69, PLAN.md D6, 2026-10-04):
// src/host/web/webFetchEntry.ts built as scripts/build.mjs builds it, then
// required by `webFetchLoader` with Node's own `require`, as the window's
// first fetch requires dist/webFetch.js. Creating the fetcher loads nothing;
// a fetch that cannot load it fails with the reason, as a refused fetch
// does, and Muse Code's URL check throws it. No test here sends a request:
// every URL is refused by the fetch's own first checks.

import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HtmlConverter } from '../../src/core/web/htmlConversion'
import { checkPageUrl } from '../../src/core/web/pageUrl'
import {
  isWebFetchBundle,
  lazyPageUrlCheck,
  lazyWebFetcher,
  webFetchLoader,
} from '../../src/host/web/webFetchBundle'
import * as webFetchEntry from '../../src/host/web/webFetchEntry'
import {
  MODEL_TEXT,
  UI_TEXT,
  WEB_FETCH_BUNDLE_FILE,
  WEB_FETCH_MODEL_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, uiLocale } from '../../src/shared/l10n/text'
import { shippedTextCases } from './helpers/bundleText'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { logLines } from './helpers/logText'

const built = builtForTests('src/host/web/webFetchEntry.ts', WEB_FETCH_BUNDLE_FILE)

// The same page over plain HTTP, which the fetch refuses before any lookup.
const PLAIN_HTTP = 'https://docs.example.com/'.replace('https:', 'http:')
// URLs the first checks refuse: plain HTTP, credentials, a link-local
// address, not a URL at all.
const REFUSED = [
  PLAIN_HTTP,
  'https://user:secret@docs.example.com/',
  'https://169.254.169.254/',
  'not a url',
]

// No page is converted here: every fetch is refused first.
const convertHtml: HtmlConverter = () => Promise.reject(new Error('no page is converted here'))

function shipped(log = new FakeLogOutputChannel()) {
  return webFetchLoader({ bundlePath: built.file, log })
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('isWebFetchBundle', () => {
  it('accepts a module that exports the check and the fetch, and nothing else', () => {
    const { checkWebPageUrl, fetchWebPageWith, readRawPromptWith } = webFetchEntry
    expect(isWebFetchBundle({ checkWebPageUrl, fetchWebPageWith, readRawPromptWith })).toBe(true)
    expect(isWebFetchBundle({ checkWebPageUrl, fetchWebPageWith })).toBe(false)
    expect(isWebFetchBundle({ checkWebPageUrl })).toBe(false)
    expect(isWebFetchBundle({ fetchWebPageWith })).toBe(false)
    expect(isWebFetchBundle({ checkWebPageUrl, fetchWebPageWith: 'no' })).toBe(false)
    expect(isWebFetchBundle(null)).toBe(false)
    expect(isWebFetchBundle('fetchWebPageWith')).toBe(false)
  })
})

describe('webFetchLoader', () => {
  lazyLoaderCases(webFetchLoader, built, () => MODEL_TEXT.webFetchUnavailable)
})

describe('the shipped web fetch bundle', () => {
  // It reads WEB_FETCH_MODEL_TEXT only.
  shippedTextCases(built, WEB_FETCH_MODEL_TEXT.webFetchUntrusted, [WEB_FETCH_MODEL_TEXT])

  it('checks a URL as the source does', () => {
    const check = lazyPageUrlCheck(shipped())
    for (const raw of REFUSED) {
      expect(check(raw), raw).toEqual(checkPageUrl(raw))
    }
    expect(check('https://Docs.Example.com/guide#part')).toMatchObject({
      ok: true,
      host: 'docs.example.com',
    })
  })

  it('fetches as the source does, and logs the host and the outcome', async () => {
    const log = new FakeLogOutputChannel()
    const fetchPage = lazyWebFetcher(shipped(), log, convertHtml)
    const signal = new AbortController().signal
    for (const raw of REFUSED) {
      const source = await webFetchEntry.fetchWebPageWith(raw, signal, undefined, {
        log: new FakeLogOutputChannel(),
        convertHtml,
        table: UI_TEXT,
        locale: uiLocale(),
      })
      expect(source.kind).toBe('failed')
      expect(await fetchPage(raw, signal), raw).toEqual(source)
    }
    expect(logLines(log)).toContain('Web fetch from docs.example.com: refused or failed: notHttps')
  })

  it('says why in the table the activation bundle installed', async () => {
    const table = { ...EN, webFetchNotHttps: 'Nur https://-Seiten werden abgerufen.' }
    setUiText(table, 'de')
    const result = await lazyWebFetcher(
      shipped(),
      new FakeLogOutputChannel(),
      convertHtml,
    )(PLAIN_HTTP, new AbortController().signal)
    expect(result).toEqual({
      kind: 'failed',
      failure: {
        kind: 'notHttps',
        reason: WEB_FETCH_MODEL_TEXT.webFetchNotHttps,
        visibleReason: table.webFetchNotHttps,
      },
    })
    const check = lazyPageUrlCheck(shipped())(PLAIN_HTTP)
    expect(check).toMatchObject({ ok: false, failure: { visibleReason: table.webFetchNotHttps } })
  })
})

describe('web fetch while its bundle cannot be loaded', () => {
  it('loads nothing until the first fetch', () => {
    const load = vi.fn()
    lazyWebFetcher(
      webFetchLoader({ bundlePath: built.file, log: new FakeLogOutputChannel(), loadBundle: load }),
      new FakeLogOutputChannel(),
      convertHtml,
    )
    lazyPageUrlCheck(
      webFetchLoader({ bundlePath: built.file, log: new FakeLogOutputChannel(), loadBundle: load }),
    )
    expect(load).not.toHaveBeenCalled()
  })

  it('fails each fetch with the reason, logs the cause, and tries again on the next one', async () => {
    const log = new FakeLogOutputChannel()
    const missing = path.join(built.folder, 'gone', WEB_FETCH_BUNDLE_FILE)
    const fetchPage = lazyWebFetcher(webFetchLoader({ bundlePath: missing, log }), log, convertHtml)
    const unavailable = {
      kind: 'failed',
      failure: {
        kind: 'unavailable',
        reason: MODEL_TEXT.webFetchUnavailable,
        visibleReason: UI_TEXT.webFetchUnavailable,
      },
    }
    const signal = new AbortController().signal
    expect(await fetchPage('https://docs.example.com/', signal)).toEqual(unavailable)
    expect(await fetchPage('https://docs.example.com/', signal)).toEqual(unavailable)
    expect(logLines(log).filter((line) => line.includes(missing))).toHaveLength(2)
  })

  it("refuses Muse Code's URL check with the reason", () => {
    const missing = path.join(built.folder, 'gone', WEB_FETCH_BUNDLE_FILE)
    const check = lazyPageUrlCheck(
      webFetchLoader({ bundlePath: missing, log: new FakeLogOutputChannel() }),
    )
    expect(() => check('https://docs.example.com/')).toThrow(MODEL_TEXT.webFetchUnavailable)
  })
})
