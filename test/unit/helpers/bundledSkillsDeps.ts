import type { BundledSkillsInstallDeps } from '../../../src/core/skills/bundledSkillsInstall'

export interface BundledSkillsArea {
  readonly vendorRoot: string
  readonly skillsRoot: string
  readonly sourcesRoot: string
}

/** The installer's dependencies over an area, with the test's clock and identity. */
export function bundledSkillsDeps(
  area: BundledSkillsArea,
  overrides: Partial<BundledSkillsInstallDeps> = {},
): BundledSkillsInstallDeps {
  return {
    log: { warn: () => undefined },
    vendorRoot: area.vendorRoot,
    skillsRoot: area.skillsRoot,
    sourcesRoot: area.sourcesRoot,
    platform: process.platform,
    now: () => Date.now(),
    newId: () => 'testid',
    ...overrides,
  }
}
