import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findBuild } from '../../scripts/release-reuse.mjs'

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/rltestdrive/release-reuse/${name}`, import.meta.url), 'utf8'),
  )

// Recorded ci.yml successes (receipt.json beside them): every run object is
// recorded; only the page assignment is the harness's (the live listing
// holds 110 runs, so three full recorded pages cannot exist). Artifacts
// answer empty (aged out), so no run matches and the scan must walk every
// page to GitHub's short-page end.
const full = () => fixture('page-full.json')
const tail = () => fixture('page-tail.json')
const TREE = '0'.repeat(40)

describe('release CI lookup paging', () => {
  it('scans past the third page to GitHub end instead of stopping', async () => {
    expect(full().workflow_runs).toHaveLength(100)
    expect(tail().workflow_runs.length).toBeLessThan(100)
    const requested = []
    const request = async (endpoint) => {
      requested.push(endpoint)
      if (endpoint.includes('/actions/workflows/')) {
        const page = Number(new URL(endpoint, 'https://api.github.com').searchParams.get('page'))
        if (page >= 1 && page <= 3) return full()
        if (page === 4) return tail()
        throw new Error(`unexpected page fetch: ${endpoint}`)
      }
      if (endpoint.includes('/artifacts')) return { artifacts: [] }
      throw new Error(`unexpected endpoint: ${endpoint}`)
    }
    const found = await findBuild('RandyNorthrup/muse-spark-code', TREE, request)
    expect(found).toBeUndefined()
    for (const page of [1, 2, 3, 4]) {
      expect(requested.filter((url) => url.includes(`&page=${page}`))).toHaveLength(1)
    }
    expect(requested.some((url) => url.includes('&page=5'))).toBe(false)
  })
})
