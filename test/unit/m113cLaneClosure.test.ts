import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')

async function readRepo(relative: string): Promise<string> {
  return await readFile(path.join(root, relative), 'utf8')
}

// RVCM1131 findings 2 and 3: the lane-level review and plan records must
// keep existing. A lane never reviews its own work, so the certification
// must name the independent review and never offer the author's pass as a
// substitute; PLAN M113 must record C-M113-1 without certifying the whole
// milestone.
describe('C-M113-1 lane records', () => {
  it('certifies the independent RVCM1131 review instead of a self-review substitute', async () => {
    const certification = await readRepo('docs/certification/m113-s-local-sources.md')
    expect(certification).toContain('RVCM1131')
    expect(certification).toContain('self-check only')
    expect(certification).toContain('Recorded limitation')
    expect(certification).not.toContain('Substitute one-pass review')
    expect(certification).not.toContain('accept the substitute below')
  })
  it('records C-M113-1 in PLAN M113 without declaring the milestone certified', async () => {
    const plan = await readRepo('PLAN.md')
    expect(plan).toContain('C-M113-1 port and RVCM1131 repair')
    expect(plan).toContain('RVCM1131 complete')
  })
})
