// Byte-exact receipt checks for recorded HTTP fixtures: the folders on
// disk match the named list, and every body matches its receipt's SHA-256
// and byte count, proving the copy is byte-exact.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'

function byName(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

/** The folders under `root` are exactly `captures`. */
export async function expectCaptureFolders(
  root: string,
  captures: readonly string[],
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  expect(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted(byName),
  ).toEqual(captures.toSorted(byName))
}

interface CaptureReceipt {
  readonly httpStatus: number
  readonly credentialsSent?: string
  readonly body: { readonly file: string; readonly bytes: number; readonly sha256: string }
}

/** The body's bytes and SHA-256 match its receipt; the send named when given.
The status is the recorded one, 200 unless the capture is a refusal. */
export async function expectReceiptHash(
  root: string,
  capture: string,
  credentialsSent?: string,
  httpStatus = 200,
): Promise<void> {
  const folder = path.join(root, capture)
  const receipt = JSON.parse(
    await readFile(path.join(folder, 'receipt.json'), 'utf8'),
  ) as CaptureReceipt
  expect(receipt.httpStatus).toBe(httpStatus)
  if (credentialsSent !== undefined) expect(receipt.credentialsSent).toBe(credentialsSent)
  expect(receipt.body.file).toBe('response.body.json')
  const body = await readFile(path.join(folder, receipt.body.file))
  expect(body.byteLength).toBe(receipt.body.bytes)
  expect(createHash('sha256').update(body).digest('hex')).toBe(receipt.body.sha256)
}
