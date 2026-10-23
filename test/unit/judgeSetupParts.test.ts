// M125 lane H: setup's pure parts. Range and resume math, the blob
// hash check, the registry manifest from M98's capture, the fetch
// plan against present blobs, the served-digest check, and version
// arithmetic. The socket runs prove in real life; everything here is
// decided without one.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isBlobDigestMatch,
  planBlobFetch,
  rangeHeader,
  sha256Hex,
} from '../../src/core/judge/setup/fetch'
import {
  isExpectedDigest,
  parseRegistryManifest,
  planModelBlobs,
} from '../../src/core/judge/setup/models'
import { compareVersions, planRuntimeUpdate } from '../../src/core/judge/setup/update'

describe('setup pure parts', () => {
  it('ranges and resumes by size, whole on anything surprising', () => {
    expect(rangeHeader(0)).toBe('bytes=0-')
    expect(rangeHeader(1_048_576)).toBe('bytes=1048576-')
    expect(planBlobFetch(100, 1000)).toEqual({ offsetBytes: 100 })
    expect(planBlobFetch(0, 1000)).toEqual({ offsetBytes: 0 })
    expect(planBlobFetch(1000, 1000)).toEqual({ offsetBytes: 0 })
    expect(planBlobFetch(2000, 1000)).toEqual({ offsetBytes: 0 })
    expect(planBlobFetch(100, undefined)).toEqual({ offsetBytes: 0 })
  })

  it('hashes blobs to their digests', () => {
    const bytes = new TextEncoder().encode('abc')
    expect(sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      isBlobDigestMatch(bytes, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    ).toBe(true)
    expect(
      isBlobDigestMatch(bytes, 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'),
    ).toBe(true)
    expect(
      isBlobDigestMatch(bytes, '0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0'),
    ).toBe(false)
  })

  it('parses the captured registry manifest and plans its blobs', async () => {
    const capture = JSON.parse(
      await readFile(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          'fixtures',
          'localJudgeCapture.json',
        ),
        'utf8',
      ),
    ) as { manifest: unknown }
    const manifest = parseRegistryManifest(JSON.stringify(capture.manifest))
    expect(manifest?.layers.length).toBeGreaterThan(0)
    // The spike's weight blob, prefix stripped to the table's bare hex.
    expect(manifest?.layers.map((layer) => layer.digest)).toContain(
      '85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9',
    )
    for (const blob of [manifest?.config, ...(manifest?.layers ?? [])]) {
      expect(blob?.digest).toMatch(/^[a-f\d]{64}$/)
      expect(blob?.size ?? 0).toBeGreaterThan(0)
    }
    expect(parseRegistryManifest('{}')).toBeUndefined()
    if (manifest === undefined) return
    const total = [manifest.config, ...manifest.layers].reduce((sum, blob) => sum + blob.size, 0)
    const empty = planModelBlobs(manifest, new Map())
    expect(empty.totalBytes).toBe(total)
    expect(empty.missingBytes).toBe(total)
    expect(empty.fetch).toHaveLength(manifest.layers.length + 1)
    const configPresent = planModelBlobs(
      manifest,
      new Map([[manifest.config.digest, manifest.config.size]]),
    )
    expect(configPresent.missingBytes).toBe(total - manifest.config.size)
    expect(configPresent.fetch[0]).toMatchObject({
      digest: manifest.config.digest,
      presentBytes: manifest.config.size,
    })
    const overPresent = planModelBlobs(
      manifest,
      new Map([[manifest.config.digest, manifest.config.size + 10]]),
    )
    expect(overPresent.missingBytes).toBe(total - manifest.config.size)
  })

  it('checks served digests case-insensitively', () => {
    const digest = '0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0'
    expect(isExpectedDigest(digest, digest.toUpperCase())).toBe(true)
    expect(isExpectedDigest(digest, 'ab'.repeat(32))).toBe(false)
  })

  it('compares versions numerically and plans runtime updates', () => {
    expect(compareVersions('0.35.1', '0.35.1')).toBe(0)
    expect(compareVersions('0.36.0', '0.35.1') ?? 0).toBeGreaterThan(0)
    expect(compareVersions('0.35.1', '0.36.0') ?? 0).toBeLessThan(0)
    expect(compareVersions('0.35.10', '0.35.9') ?? 0).toBeGreaterThan(0)
    expect(compareVersions('nope', '0.35.1')).toBeUndefined()
    expect(compareVersions('0.35.1', 'nope')).toBeUndefined()
    expect(planRuntimeUpdate(undefined, '0.35.1')).toEqual({
      current: undefined,
      pinned: '0.35.1',
      updateAvailable: true,
    })
    expect(planRuntimeUpdate('0.35.1', '0.35.1').updateAvailable).toBe(false)
    expect(planRuntimeUpdate('0.34.0', '0.35.1').updateAvailable).toBe(true)
    expect(planRuntimeUpdate('0.36.0', '0.35.1').updateAvailable).toBe(false)
    expect(planRuntimeUpdate('nope', '0.35.1').updateAvailable).toBe(false)
  })
})
