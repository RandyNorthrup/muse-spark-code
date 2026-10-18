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

async function readCapture(
  name: 'big-txt' | 'example',
  rawTextLimit?: number,
): Promise<{ result: Awaited<ReturnType<typeof fetchWebPage>>; closed: number; capture: Capture }> {
  const { body, capture } = loadCapture(name)
  const closed = { count: 0 }
  const result = await fetchWebPage(
    capture.finalUrl,
    depsFor(recordedResponse(body, capture.responseHeaders, closed), rawTextLimit),
    new AbortController().signal,
  )
  return { result, closed: closed.count, capture }
}

function expectPage(
  actual: Awaited<ReturnType<typeof fetchWebPage>>,
  closed: number,
): asserts actual is { kind: 'page'; page: { bytes: number }; text: string } & typeof actual {
  expect(actual).toMatchObject({ kind: 'page' })
  if (actual.kind !== 'page') throw new Error('expected the page to read')
  expect(closed).toBe(1)
}

describe('web fetch decompression window', () => {
  it('streams a real body past the window truncated-with-notice instead of refusing', async () => {
    const { result, closed, capture } = await readCapture('big-txt')
    expect(capture.decompressedBytes).toBeGreaterThan(WEB_FETCH_BUFFER_WINDOW_BYTES)
    expectPage(result, closed)
    // Only the window is ever buffered, however far the gzip expands.
    expect(result.page.bytes).toBe(WEB_FETCH_BUFFER_WINDOW_BYTES)
    expect(result.text).toContain('Project Gutenberg')
    expect(result.text).toContain('the page has more')
  })

  it('still reads a real small page whole, HTML converted', async () => {
    const { result, closed, capture } = await readCapture('example')
    expectPage(result, closed)
    expect(result.page.bytes).toBe(capture.decompressedBytes)
    expect(result.text).toContain('Example Domain')
  })

  it('keeps a smaller caller cap when the caller named one', async () => {
    const { result } = await readCapture('big-txt', 10)
    expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'tooLarge' } })
  })
})
