import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { requiresProductionBuild } from './productionBuild'

describe('the shared production build (vitest global setup)', () => {
  const root = path.resolve('repo-root')
  const at = (file: string) => path.join(root, file)

  it('builds when a selected file serves dist/, whatever the path separators', () => {
    expect(requiresProductionBuild(root, [at('test/unit/devicesPhase2Harness.test.mjs')])).toBe(
      true,
    )
    expect(
      requiresProductionBuild(root, [
        at('test/unit/a.test.ts'),
        at('test/unit/teamHarness.test.mjs').replaceAll('\\', '/'),
      ]),
    ).toBe(true)
  })

  it('skips the build when no selected file serves dist/', () => {
    expect(requiresProductionBuild(root, [])).toBe(false)
    expect(requiresProductionBuild(root, [at('test/unit/devicesPanel.test.ts')])).toBe(false)
    expect(
      requiresProductionBuild(root, [path.join(root, 'other', 'test/unit/teamHarness.test.mjs')]),
    ).toBe(false)
  })
})
