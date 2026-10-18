import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertHtmlJob } from '../../src/core/web/htmlToMarkdown'
import type { HtmlConversion } from '../../src/core/web/htmlConversion'
import { UndecodableText } from '../../src/core/web/textDecoding'
import {
  fetchWebPage,
  type Nat64Discovery,
  type PinnedResponse,
  type WebFetchDeps,
} from '../../src/core/web/webFetch'
import { WEB_FETCH_BUFFER_WINDOW_BYTES } from '../../src/shared/constants'

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'webfetch',
)

// Recorded real exchanges (PR #214 review): each capture names its URL,
// capture date and command, and the wire bytes are the server's body
// byte-for-byte, hashed to the provenance file. The injected transport seam
// below never dials.
interface Capture {
  readonly finalUrl: string
  readonly responseHeaders: Record<string, string>
  readonly wireFile: string
  readonly wireSha256: string
  readonly decompressedBytes: number
}

function loadCapture(name: 'big-txt' | 'example'): { body: Buffer; capture: Capture } {
  const capture = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Capture
  const body = readFileSync(path.join(FIXTURES, capture.wireFile))
  expect(createHash('sha256').update(body).digest('hex')).toBe(capture.wireSha256)
  return { body, capture }
}

function recordedResponse(
  body: Buffer,
  headers: Record<string, string>,
  closed?: { count: number },
): PinnedResponse {
  const released = closed ?? { count: 0 }
  return {
    status: 200,
    headers,
    body: (async function* () {
      const piece = 64 * 1024
      for (let at = 0; at < body.length; at += piece) {
        await Promise.resolve()
        yield body.subarray(at, Math.min(at + piece, body.length))
      }
    })(),
    // The stubs never dial; closing only records that the fetch let go.
    close() {
      released.count += 1
    },
  }
}

const noNat64: Nat64Discovery = { isKnown: true, prefixes: [] }

function depsFor(response: PinnedResponse, rawTextLimit?: number): WebFetchDeps {
  return {
    resolve: () => Promise.resolve(['8.8.8.8']),
    nat64: () => Promise.resolve(noNat64),
    request: () => Promise.resolve(response),
    // The real converter in the worker's envelope (pageWorker.ts), on the
    // recorded bytes: Markdown back on success, the refusal it maps.
    convertHtml: (job): Promise<HtmlConversion> => {
      try {
        return Promise.resolve({ ok: true, page: convertHtmlJob(job) })
      } catch (error: unknown) {
        if (error instanceof UndecodableText) {
          return Promise.resolve({ ok: false, kind: 'undecodable', detail: error.encoding })
        }
        throw error
      }
    },
    newMarker: () => 'marker',
    ...(rawTextLimit !== undefined && { rawTextLimit }),
  }
}

describe('web fetch decompression window', () => {
  it('streams a real body past the window truncated-with-notice instead of refusing', async () => {
    const { body, capture } = loadCapture('big-txt')
    expect(capture.decompressedBytes).toBeGreaterThan(WEB_FETCH_BUFFER_WINDOW_BYTES)
    const closed = { count: 0 }
    const result = await fetchWebPage(
      capture.finalUrl,
      depsFor(recordedResponse(body, capture.responseHeaders, closed)),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'page' })
    if (result.kind !== 'page') throw new Error('expected the large page to read')
    // Only the window is ever buffered, however far the gzip expands.
    expect(result.page.bytes).toBe(WEB_FETCH_BUFFER_WINDOW_BYTES)
    expect(result.text).toContain('Project Gutenberg')
    expect(result.text).toContain('the page has more')
    expect(closed.count).toBe(1)
  })

  it('still reads a real small page whole, HTML converted', async () => {
    const { body, capture } = loadCapture('example')
    const closed = { count: 0 }
    const result = await fetchWebPage(
      capture.finalUrl,
      depsFor(recordedResponse(body, capture.responseHeaders, closed)),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'page' })
    if (result.kind !== 'page') throw new Error('expected the small page to read')
    expect(result.page.bytes).toBe(capture.decompressedBytes)
    expect(result.text).toContain('Example Domain')
    expect(closed.count).toBe(1)
  })

  it('keeps a smaller caller cap when the caller named one', async () => {
    const { body, capture } = loadCapture('big-txt')
    const result = await fetchWebPage(
      capture.finalUrl,
      depsFor(recordedResponse(body, capture.responseHeaders), 10),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'tooLarge' } })
  })
})
