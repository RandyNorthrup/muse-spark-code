import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  fetchWebPage,
  type HtmlConverter,
  type Nat64Discovery,
  type PinnedResponse,
  type WebFetchDeps,
} from '../../src/core/web/webFetch'
import { WEB_FETCH_MAX_BODY_BYTES } from '../../src/shared/constants'

// The trusted policy's post-decompression bound (SECURITY.md, PR #214
// review): every product call buffers at most 5 MiB of decompressed body,
// even when the caller named no smaller ingress cap. The bytes here are
// real gzip (node:zlib) really decompressed by the product's gunzip path;
// only the socket is stubbed at the injected-transport seam, and the stub
// never dials: the declared content-length stays under the cap while the
// decompressed body does not, which is exactly a compression bomb's shape.
const SIX_MIB = 6 * 1024 * 1024

function gzipBody(decompressedBytes: number): Buffer {
  return gzipSync(Buffer.alloc(decompressedBytes, 'a'))
}

function cannedGzip(decompressedBytes: number, closed?: { count: number }): PinnedResponse {
  const released = closed ?? { count: 0 }
  const compressed = gzipBody(decompressedBytes)
  return {
    status: 200,
    headers: {
      'content-type': 'text/plain',
      'content-encoding': 'gzip',
      'content-length': String(compressed.length),
    },
    body: (async function* () {
      const piece = 64 * 1024
      for (let at = 0; at < compressed.length; at += piece) {
        await Promise.resolve()
        yield compressed.subarray(at, Math.min(at + piece, compressed.length))
      }
    })(),
    // The stub never dials; closing only records that the fetch let go.
    close() {
      released.count += 1
    },
  }
}

const neverConvert: HtmlConverter = () =>
  Promise.reject(new Error('plain text must not reach the HTML converter'))
const noNat64: Nat64Discovery = { isKnown: true, prefixes: [] }

function depsFor(response: PinnedResponse, rawTextLimit?: number): WebFetchDeps {
  return {
    resolve: () => Promise.resolve(['8.8.8.8']),
    nat64: () => Promise.resolve(noNat64),
    request: () => Promise.resolve(response),
    convertHtml: neverConvert,
    newMarker: () => 'marker',
    ...(rawTextLimit !== undefined && { rawTextLimit }),
  }
}

describe('web fetch decompression bomb guard', () => {
  it('refuses a body that decompresses past 5 MiB when no cap was named', async () => {
    expect(WEB_FETCH_MAX_BODY_BYTES).toBe(5 * 1024 * 1024)
    const closed = { count: 0 }
    const result = await fetchWebPage(
      'https://example.com/large.txt',
      depsFor(cannedGzip(SIX_MIB, closed)),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'tooLarge' } })
    expect(closed.count).toBe(1)
  })

  it('still reads a small gzip body when no cap was named', async () => {
    const result = await fetchWebPage(
      'https://example.com/small.txt',
      depsFor(cannedGzip(100)),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'page' })
    if (result.kind !== 'page') throw new Error('expected the small page to read')
    expect(result.page.bytes).toBe(100)
  })

  it('keeps a smaller caller cap when the caller named one', async () => {
    const result = await fetchWebPage(
      'https://example.com/small.txt',
      depsFor(cannedGzip(100), 10),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'tooLarge' } })
  })
})
