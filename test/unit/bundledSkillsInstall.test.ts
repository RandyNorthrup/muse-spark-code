// The bundled skills install's failure reads
// (src/host/skills/bundledSkillsInstall.ts): a missing entry steers the
// flow (absent, not ours, a link to make); every other failure becomes
// failure data, never a throw, after the run undoes what it made.
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installBundledSkills,
  removeBundledSkills,
  type BundledSkillsInstallDeps,
} from '../../src/host/skills/bundledSkillsInstall'

interface Area {
  readonly root: string
  readonly vendorRoot: string
  readonly skillsRoot: string
  readonly sourcesRoot: string
  readonly cleanup: () => Promise<void>
}

/** A real vendor package: VENDOR.json, one skill, an empty first-party source. */
async function realArea(): Promise<Area> {
  const root = await mkdtemp(path.join(tmpdir(), 'bundled-skills-'))
  const vendorRoot = path.join(root, 'w', 'vendor')
  await mkdir(path.join(vendorRoot, 'skills', 'alpha'), { recursive: true })
  await writeFile(
    path.join(vendorRoot, 'VENDOR.json'),
    JSON.stringify({ tag: '9', files: [{ path: 'skills/alpha/SKILL.md' }] }),
  )
  await writeFile(path.join(vendorRoot, 'skills', 'alpha', 'SKILL.md'), '# Alpha\n')
  await mkdir(path.join(root, 'first-party-skills'), { recursive: true })
  return {
    root,
    vendorRoot,
    skillsRoot: path.join(root, 'skills'),
    sourcesRoot: path.join(root, 'sources'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

function deps(
  area: Area,
  overrides: Partial<BundledSkillsInstallDeps> = {},
): BundledSkillsInstallDeps {
  return {
    vendorRoot: area.vendorRoot,
    skillsRoot: area.skillsRoot,
    sourcesRoot: area.sourcesRoot,
    platform: process.platform,
    now: () => Date.now(),
    newId: () => 'testid',
    ...overrides,
  }
}

describe('bundledSkillsInstall failures', () => {
  it('installs the vendored skill and marks the copy', async () => {
    const area = await realArea()
    try {
      const result = await installBundledSkills(deps(area))
      expect(result.failure).toBeUndefined()
      expect(result.tag).toBe('9')
      expect(result.installed).toEqual(['alpha'])
      const link = path.join(area.skillsRoot, 'alpha')
      const linkStats = await lstat(link)
      expect(linkStats.isSymbolicLink()).toBe(true)
      expect(await readlink(link)).toContain('alpha')
      const marker = JSON.parse(
        await readFile(
          path.join(area.sourcesRoot, 'high-quality-projects-skill', '.muse-spark-bundled.json'),
          'utf8',
        ),
      ) as { readonly tag?: unknown }
      expect(marker.tag).toBe('9')
    } finally {
      await area.cleanup()
    }
  })

  it('returns failure data, never a throw, when the vendor record is missing', async () => {
    const area = await realArea()
    try {
      const result = await installBundledSkills(
        deps(area, { vendorRoot: path.join(area.root, 'no-vendor') }),
      )
      expect(result.tag).toBeUndefined()
      expect(result.failure?.folder).toBe(path.join(area.root, 'no-vendor'))
      expect(result.failure?.reason.kind).toBe('error')
    } finally {
      await area.cleanup()
    }
  })

  it('undoes the copy and returns failure data when the skills folder is blocked', async () => {
    const area = await realArea()
    try {
      await writeFile(area.skillsRoot, 'a file, not a folder\n')
      const result = await installBundledSkills(deps(area))
      expect(result.tag).toBe('9')
      expect(result.failure).toBeDefined()
      expect(result.failure?.reason.kind).toBe('error')
      expect(result.undoFailure).toBeUndefined()
      expect(existsSync(path.join(area.sourcesRoot, 'high-quality-projects-skill'))).toBe(false)
    } finally {
      await area.cleanup()
    }
  })

  it('treats a missing extension root as no extra skills', async () => {
    const area = await realArea()
    try {
      const result = await installBundledSkills(
        deps(area, { extensionSkillsRoot: path.join(area.root, 'no-extension-skills') }),
      )
      expect(result.failure).toBeUndefined()
      expect(result.installed).toEqual(['alpha'])
    } finally {
      await area.cleanup()
    }
  })

  it('leaves a skill folder without a skill file out of the extras', async () => {
    const area = await realArea()
    try {
      const extensionRoot = path.join(area.root, 'extension-skills')
      await mkdir(path.join(extensionRoot, 'beta'), { recursive: true })
      const result = await installBundledSkills(deps(area, { extensionSkillsRoot: extensionRoot }))
      expect(result.failure).toBeUndefined()
      expect(result.installed).toEqual(['alpha'])
    } finally {
      await area.cleanup()
    }
  })

  it('removes nothing without a copy', async () => {
    const area = await realArea()
    try {
      const result = await removeBundledSkills(area)
      expect(result).toEqual({ removed: [], hadCopy: false, failure: undefined })
    } finally {
      await area.cleanup()
    }
  })

  it('leaves a folder without the mark alone', async () => {
    const area = await realArea()
    try {
      const folder = path.join(area.sourcesRoot, 'high-quality-projects-skill')
      await mkdir(folder, { recursive: true })
      await writeFile(
        path.join(folder, '.muse-spark-bundled.json'),
        'this is not a marker record\n',
      )
      const result = await removeBundledSkills(area)
      expect(result.hadCopy).toBe(false)
      expect(result.failure).toBeUndefined()
    } finally {
      await area.cleanup()
    }
  })

  it('removes the links and the copy after an install', async () => {
    const area = await realArea()
    try {
      const installed = await installBundledSkills(deps(area))
      expect(installed.failure).toBeUndefined()
      const result = await removeBundledSkills(area)
      expect(result.failure).toBeUndefined()
      expect(result.hadCopy).toBe(true)
      expect(result.removed).toEqual(['alpha'])
    } finally {
      await area.cleanup()
    }
  })
})
