// Recorded web captures replayed through the real fetch path: loopback deps
// serve the recorded bytes in 64 KiB pieces, and closing only records that
// the fetch let go. Captures stay verified against their recorded hashes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'
import type { HtmlConverter } from '../../../src/core/web/htmlConversion'
import type { Nat64Discovery, PinnedResponse, WebFetchDeps } from '../../../src/core/web/webFetch'

export interface WebCaptureBody {
  readonly body: Buffer
  readonly capture: {
    readonly finalUrl: string
    readonly responseHeaders: Record<string, string>
    readonly wireFile: string
    readonly wireSha256: string
    readonly decompressedBytes: number
  }
}

/** A recorded capture with its wire bytes, hash-checked against the record. */
export function loadWebCapture(fixturesDir: string, name: string): WebCaptureBody {
  const capture = JSON.parse(readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8')) as {
    readonly finalUrl: string
    readonly responseHeaders: Record<string, string>
    readonly wireFile: string
    readonly wireSha256: string
    readonly decompressedBytes: number
  }
  const body = readFileSync(path.join(fixturesDir, capture.wireFile))
  expect(createHash('sha256').update(body).digest('hex')).toBe(capture.wireSha256)
  return { body, capture }
}

/** The recorded bytes as a pinned 200 response, yielded in 64 KiB pieces. */
export function recordedPinnedResponse(
  body: Buffer,
  headers: Record<string, string>,
  onClose?: () => void,
): PinnedResponse {
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
    close() {
      onClose?.()
    },
  }
}

const noNat64: Nat64Discovery = { isKnown: true, prefixes: [] }

/** Loopback fetch deps: no dial, the recorded response, the given converter. */
export function recordedFetchDeps(
  response: PinnedResponse,
  convertHtml: HtmlConverter,
): WebFetchDeps {
  return {
    resolve: () => Promise.resolve(['8.8.8.8']),
    nat64: () => Promise.resolve(noNat64),
    request: () => Promise.resolve(response),
    convertHtml,
    newMarker: () => 'marker',
  }
}
