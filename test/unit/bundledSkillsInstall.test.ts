// The bundled skills install's failure reads
// (src/core/skills/bundledSkillsInstall.ts): a missing entry steers the
// flow (absent, not ours, a link to make); every other failure becomes
// failure data, never a throw, after the run undoes what it made. The
// staged copy is verified against the release's hashes before it replaces
// anything (H17): changed, extra or missing bytes, and unsafe or duplicate
// vendor paths, fail the install and leave the installed copy alone.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installBundledSkills,
  removeBundledSkills,
  type BundledSkillsInstallDeps,
} from '../../src/core/skills/bundledSkillsInstall'

interface Area {
  readonly root: string
  readonly log: { warn: (message: string) => void }
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
  const skillText = '# Alpha\n'
  await writeFile(path.join(vendorRoot, 'skills', 'alpha', 'SKILL.md'), skillText)
  await writeFile(
    path.join(vendorRoot, 'VENDOR.json'),
    JSON.stringify({
      tag: '9',
      files: [
        {
          path: 'skills/alpha/SKILL.md',
          sha256: createHash('sha256').update(skillText).digest('hex'),
        },
      ],
    }),
  )
  await mkdir(path.join(root, 'first-party-skills'), { recursive: true })
  return {
    root,
    log: { warn: () => undefined },
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
      // JSON.parse returns any; the file holds the marker this test's install wrote.
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

  it.each(['changed', 'extra', 'missing'])(
    'refuses %s release bytes before replacing an installed copy',
    async (kind) => {
      const area = await realArea()
      try {
        const installed = await installBundledSkills(deps(area))
        expect(installed.failure).toBeUndefined()
        const copySkill = path.join(
          area.sourcesRoot,
          'high-quality-projects-skill',
          'skills',
          'alpha',
          'SKILL.md',
        )
        const original = await readFile(copySkill, 'utf8')
        const newer = path.join(area.root, 'newer')
        await mkdir(path.join(newer, 'skills', 'alpha'), { recursive: true })
        await writeFile(
          path.join(newer, 'VENDOR.json'),
          await readFile(path.join(area.vendorRoot, 'VENDOR.json'), 'utf8'),
        )
        const newerSkill = path.join(newer, 'skills', 'alpha', 'SKILL.md')
        if (kind === 'missing') {
          await writeFile(newerSkill, '# Alpha\n')
          await rm(newerSkill)
        } else {
          await writeFile(
            kind === 'extra' ? path.join(newer, 'extra.sh') : newerSkill,
            kind === 'extra' ? 'changed\n' : '# Alpha, tampered\n',
          )
          if (kind === 'extra') await writeFile(newerSkill, '# Alpha\n')
        }
        const result = await installBundledSkills(deps(area, { vendorRoot: newer }))
        expect(result.failure?.reason.kind).toBe('error')
        expect(result.installed).toEqual([])
        expect(await readFile(copySkill, 'utf8')).toBe(original)
        expect(await readdir(area.sourcesRoot)).toEqual(['high-quality-projects-skill'])
      } finally {
        await area.cleanup()
      }
    },
  )

  it.each([
    ['../outside', 'lists unsafe or duplicate files'],
    ['skills/../outside', 'lists unsafe or duplicate files'],
    ['/absolute', 'is not a vendor record'],
    [String.raw`skills\outside`, 'is not a vendor record'],
    ['README.md.', 'lists unsafe or duplicate files'],
    ['SKILLS/ALPHA/SKILL.md', 'lists unsafe or duplicate files'],
  ])('refuses unsafe or duplicate vendor path %s before writing', async (name, said) => {
    const area = await realArea()
    try {
      const file = path.join(area.vendorRoot, 'VENDOR.json')
      const manifest = JSON.parse(await readFile(file, 'utf8')) as {
        files: { path: string; sha256: string }[]
      }
      manifest.files.push({ path: name, sha256: 'ab'.repeat(32) })
      await writeFile(file, JSON.stringify(manifest))
      const result = await installBundledSkills(deps(area))
      expect(result.failure?.reason.kind).toBe('error')
      // The layer that refused: the path check, not the later byte check.
      const reason = result.failure?.reason
      expect(reason?.kind === 'error' ? reason.message : '').toContain(said)
      expect(existsSync(area.sourcesRoot)).toBe(false)
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

  it('warns the log in fixed words when the vendor record is missing', async () => {
    const area = await realArea()
    try {
      const warnings: string[] = []
      const result = await installBundledSkills(
        deps(area, {
          vendorRoot: path.join(area.root, 'no-vendor'),
          log: {
            warn: (message: string) => {
              warnings.push(message)
            },
          },
        }),
      )
      expect(result.failure?.reason.kind).toBe('error')
      expect(warnings).toHaveLength(1)
      const [said] = warnings
      expect(said).toContain('vendor record unreadable')
      expect(said ?? '').not.toContain('no-vendor')
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
