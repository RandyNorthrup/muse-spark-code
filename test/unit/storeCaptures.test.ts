// Lane C-M113-6 store captures (2026-10-11, lead's N-captures handoff):
// every fixture body in test/fixtures/m113/stores/ must match its
// receipt's SHA-256 and byte count, proving the copy is byte-exact.
// `.prettierignore` keeps formatters from rewriting the bodies.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const STORES = path.join(__dirname, '..', 'fixtures', 'm113', 'stores')

function byName(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

const CAPTURES = [
  'marketplace-extensionquery',
  'openvsx-extension',
  'github-actions-runs-page1',
  'github-actions-runs-page2',
  'github-workflow-release-runs',
  'github-releases-page1',
  'github-releases-page2',
  'github-releases-latest',
  'github-tags-page1',
  'npm-latest',
]

describe('store capture fixtures', () => {
  it('holds exactly the ten captured folders', async () => {
    const entries = await readdir(STORES, { withFileTypes: true })
    expect(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted(byName),
    ).toEqual(CAPTURES.toSorted(byName))
  })

  it('reads the latest release from the first page, never a separate shape', async () => {
    // The capture record states `/releases/latest` equals page 1's first
    // element: the adapter pages `/releases` only, so no second release
    // shape is parsed.
    const latest = JSON.parse(
      await readFile(path.join(STORES, 'github-releases-latest', 'response.body.json'), 'utf8'),
    ) as unknown
    const page = JSON.parse(
      await readFile(path.join(STORES, 'github-releases-page1', 'response.body.json'), 'utf8'),
    ) as unknown[]
    expect(latest).toEqual(page[0])
  })

  it.each(CAPTURES)('matches the receipt hash for %s', async (capture) => {
    const folder = path.join(STORES, capture)
    const receipt = JSON.parse(await readFile(path.join(folder, 'receipt.json'), 'utf8')) as {
      body: { file: string; bytes: number; sha256: string }
      httpStatus: number
    }
    expect(receipt.httpStatus).toBe(200)
    expect(receipt.body.file).toBe('response.body.json')
    const body = await readFile(path.join(folder, receipt.body.file))
    expect(body.byteLength).toBe(receipt.body.bytes)
    expect(createHash('sha256').update(body).digest('hex')).toBe(receipt.body.sha256)
  })
})
