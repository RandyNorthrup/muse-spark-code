import { describe, expect, it } from 'vitest'
import { nodeImageRetention } from '../../scripts/retain-node-images.mjs'

const digest = (id) => `sha256:${String(id).padStart(64, '0')}`
const version = (id, tags) => ({
  id,
  name: digest(id),
  created_at: new Date(id * 100_000).toISOString(),
  metadata: { container: { tags } },
})
const manifest = { schemaVersion: 2, config: { digest: digest(500) }, layers: [] }

describe('bounded registry retention', () => {
  it('keeps ten release graphs, their untagged platforms/attestations and cosign attachments', () => {
    const versions = Array.from({ length: 12 }, (_, index) => version(index + 1, [`v0.1.${index}`]))
    versions.push(
      version(20, []),
      version(21, []),
      version(22, [`sha256-${digest(3).slice(7)}.sig`]),
      version(23, [`sha256-${digest(1).slice(7)}.att`]),
      version(24, []),
    )
    const graph = (reference) =>
      reference === digest(3)
        ? { schemaVersion: 2, manifests: [{ digest: digest(20) }, { digest: digest(21) }] }
        : manifest
    expect(nodeImageRetention(versions, graph).toSorted((a, b) => a - b)).toEqual([1, 2, 23, 24])
  })
  it('preserves stable/preview roots and manually tagged images', () => {
    const versions = Array.from({ length: 12 }, (_, index) => version(index + 1, [`v0.1.${index}`]))
    versions[0].metadata.container.tags.push('stable')
    versions[1].metadata.container.tags.push('preview')
    versions.push(
      version(20, ['operator-owned']),
      version(21, ['build-123-1-arm64']),
      version(22, []),
    )
    expect(
      nodeImageRetention(versions, (reference) =>
        reference === digest(20)
          ? { schemaVersion: 2, manifests: [{ digest: digest(22) }] }
          : manifest,
      ),
    ).toEqual([21])
  })
  it('never deletes when roots are absent or graph reads fail/malformed', () => {
    expect(() => nodeImageRetention([version(1, [])], () => manifest)).toThrow(
      'No retained release',
    )
    expect(() =>
      nodeImageRetention([version(1, ['v0.1.0'])], () => {
        throw new Error('registry refused')
      }),
    ).toThrow('registry refused')
    expect(() => nodeImageRetention([version(1, ['v0.1.0'])], () => ({}))).toThrow()
  })
  it('terminates on cycles while preserving subject references', () => {
    const versions = [version(1, ['v0.1.0']), version(2, []), version(3, [])]
    expect(
      nodeImageRetention(versions, (reference) => ({
        ...manifest,
        subject: { digest: digest(reference === digest(1) ? 2 : 1) },
      })),
    ).toEqual([3])
  })
})
