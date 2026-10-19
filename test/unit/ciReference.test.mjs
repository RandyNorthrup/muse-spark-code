// The other-CI help states the launcher's system dimension (RVCM80CI4 P3,
// re-homed after the test overhaul removed referenceGenerator.test.mjs).
// Real modules only: the reference builder, the feature catalog and the
// English table it reads, the launcher's own system list, and the rendered
// Markdown; no fakes, no timers, no network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CI_SYSTEMS } from '../../action/lib/ci-adapters.mjs'
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
  it('covers every system the launcher branches on, through the real renderer', () => {
    const feature = model.features.find((entry) => entry.id === 'ci-other-systems')
    if (feature === undefined) throw new Error('missing ci-other-systems feature')
    // The catalog names the dimension the launcher branches on.
    for (const ref of [feature.summary, feature.description]) {
      expect(ref).toEqual({ conditions: [{ when: 'system', text: { ui: 'referenceCiOther' } }] })
    }
    const rendered = referenceMarkdown(model, source, nls, manifest)
    const heading = '### Other CI systems'
    const start = rendered.indexOf(heading)
    if (start === -1) throw new Error('missing Other CI systems section')
    const rest = rendered.slice(start + heading.length)
    const end = rest.search(/\n#{2,3} /)
    const section = end === -1 ? rest : rest.slice(0, end)
    // The renderer resolves the ui key through the installed English table:
    // the raw key never reaches the section, and the resolved paragraph
    // names every system the launcher branches on, so help cannot silently
    // drop one when the launcher gains or loses a system.
    expect(section).not.toContain('referenceCiOther')
    for (const system of CI_SYSTEMS) {
      expect(section.toLowerCase(), system).toContain(system)
    }
  })
})
