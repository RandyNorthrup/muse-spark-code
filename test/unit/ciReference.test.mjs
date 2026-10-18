// The other-CI help states the launcher's system dimension (RVCM80CI4 P3,
// re-homed after the test overhaul removed referenceGenerator.test.mjs).
// Real modules only: the reference builder, the feature catalog and the
// English table it reads; no fakes, no timers, no network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateReference,
  referenceMarkdown,
  referenceSources,
} from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const source = await referenceSources(root)
const model = await generateReference(root, true)

describe('other-CI help reference', () => {
  it('names the system dimension the launcher branches on', () => {
    // The invented ciVendor&artifactTransport&secretIsolation selector named
    // nothing the product sets. The condition now names the system dimension
    // (gitlab/azure/jenkins/bitbucket) the launcher branches on, whose
    // per-system states the paragraph explains.
    const feature = model.features.find((entry) => entry.id === 'ci-other-systems')
    if (feature === undefined) throw new Error('missing ci-other-systems feature')
    for (const ref of [feature.summary, feature.description]) {
      expect(ref).toEqual({ conditions: [{ when: 'system', text: { ui: 'referenceCiOther' } }] })
    }
    expect(referenceMarkdown(model, source, nls, manifest)).toContain('system: Digest-pinned')
    expect(referenceMarkdown(model, source, nls, manifest)).not.toContain('ciVendor')
  })
})
