// VSIXWEB B: the vendored skill package's solid archive. The real
// producer packs the real vendored tree into a real archive, keeping
// LICENSE and VENDOR.json loose; the real installer stages byte-identical
// from the archive, and a damaged member refuses as a damaged tree does.
// The real skill loader lists the same skills through the archive-backed
// reader as through the loose tree, and a damaged archive warns instead of
// failing the turn.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  copyRig,
  damageSolidArchiveBytes,
  damageSolidArchiveMember,
  readSolidArchiveMembers,
} from './helpers/solidArchive'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { withBundledSkillsArchive } from '../../src/core/context/bundledSkillsArchive'
import { bundledSkillsRoot, loadSkills, type SkillRoot } from '../../src/core/context/skills'
import { installBundledSkills } from '../../src/host/skills/bundledSkillsInstall'
import {
  BUNDLED_SKILLS_ARCHIVE_FILE,
  BUNDLED_SKILLS_ARCHIVE_VERSION,
} from '../../src/shared/constants'
import { packSolidTextArchive } from '../../scripts/lib/solidTextArchive.mjs'

const VENDOR = path.resolve('vendor/high-quality-projects-skill')
const PACKAGE = 'high-quality-projects-skill'

const root = mkdtempSync(path.join(tmpdir(), 'muse-skill-archive-'))
// The loose tree the tests never alter, and the packaged layout: the same
// files with the solid archive beside the package and only the loose
// evidence and attribution left inside it.
const looseVendor = path.join(root, 'loose', PACKAGE)
const packagedParent = path.join(root, 'packaged')
const packagedVendor = path.join(packagedParent, PACKAGE)
const packagedArchive = path.join(packagedParent, BUNDLED_SKILLS_ARCHIVE_FILE)

const byName = (left: string, right: string): number => left.localeCompare(right, 'en')

/** Every file under a tree by posix relative path with its exact bytes. */
function treeBytes(directory: string): Record<string, Buffer> {
  const found: Record<string, Buffer> = {}
  const visit = (absolute: string, prefix: string): void => {
    const entries = readdirSync(absolute, { withFileTypes: true }).toSorted((left, right) =>
      byName(left.name, right.name),
    )
    for (const entry of entries) {
      const file = path.join(absolute, entry.name)
      if (entry.isDirectory()) visit(file, `${prefix}${entry.name}/`)
      else if (entry.isFile()) found[`${prefix}${entry.name}`] = readFileSync(file)
    }
  }
  visit(directory, '')
  return found
}

function sortedKeys(found: Record<string, Buffer>): string[] {
  return Object.keys(found).toSorted(byName)
}

/** A skill root over a vendor tree, for the listing comparison. */
function rootsFor(vendorRoot: string): SkillRoot[] {
  return [
    {
      directory: bundledSkillsRoot(vendorRoot, process.platform),
      source: 'bundled',
      confineTo: vendorRoot,
      packageRoot: vendorRoot,
    },
  ]
}

beforeAll(() => {
  cpSync(VENDOR, looseVendor, { recursive: true })
  const packed = packSolidTextArchive(
    VENDOR,
    path.join(root, 'stage', BUNDLED_SKILLS_ARCHIVE_FILE),
    {
      keep: new Set(['LICENSE', 'VENDOR.json']),
    },
  )
  expect(packed.members).toBeGreaterThan(0)
  mkdirSync(packagedVendor, { recursive: true })
  // The packaged layout: the archive beside only the loose evidence and
  // attribution, exactly what the stage check ships.
  for (const name of ['LICENSE', 'VENDOR.json']) {
    cpSync(path.join(VENDOR, name), path.join(packagedVendor, name))
  }
  cpSync(path.join(root, 'stage', BUNDLED_SKILLS_ARCHIVE_FILE), packagedArchive)
  mkdirSync(path.join(root, 'first-party-skills'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A real install area: the packaged vendor tree with its archive beside it. */
function installArea(): {
  vendorRoot: string
  skillsRoot: string
  sourcesRoot: string
  cleanup: () => void
} {
  const area = mkdtempSync(path.join(tmpdir(), 'muse-skill-install-'))
  const vendorRoot = path.join(area, 'vendor', PACKAGE)
  mkdirSync(path.dirname(vendorRoot), { recursive: true })
  cpSync(packagedVendor, vendorRoot, { recursive: true })
  cpSync(packagedArchive, path.join(area, 'vendor', BUNDLED_SKILLS_ARCHIVE_FILE))
  mkdirSync(path.join(area, 'first-party-skills'), { recursive: true })
  return {
    vendorRoot,
    skillsRoot: path.join(area, 'skills'),
    sourcesRoot: path.join(area, 'sources'),
    cleanup: () => {
      rmSync(area, { recursive: true, force: true })
    },
  }
}

/** The real installer over an area, with the test's clock and identity. */
function install(area: { vendorRoot: string; skillsRoot: string; sourcesRoot: string }) {
  return installBundledSkills({
    vendorRoot: area.vendorRoot,
    skillsRoot: area.skillsRoot,
    sourcesRoot: area.sourcesRoot,
    platform: process.platform,
    now: () => Date.now(),
    newId: () => 'testid',
  })
}

/** The installed copy's staged tree, without the installer's own marker. */
function installedTree(sourcesRoot: string): Record<string, Buffer> {
  const copy = path.join(sourcesRoot, PACKAGE)
  const marker = path.join(copy, '.muse-spark-bundled.json')
  rmSync(marker, { force: true })
  return treeBytes(copy)
}

describe('packaged skill archive', () => {
  it('ships the archive beside two loose files and nothing else loose', () => {
    expect(existsSync(packagedArchive)).toBe(true)
    expect(existsSync(path.join(packagedVendor, 'LICENSE'))).toBe(true)
    expect(existsSync(path.join(packagedVendor, 'VENDOR.json'))).toBe(true)
    // Every other loose member left with the archive.
    expect(sortedKeys(treeBytes(packagedVendor))).toEqual(['LICENSE', 'VENDOR.json'])
    // The archive holds the rest: the full VENDOR.json list minus LICENSE.
    const vendor = JSON.parse(readFileSync(path.join(packagedVendor, 'VENDOR.json'), 'utf8')) as {
      files: { path: string }[]
    }
    const files = readSolidArchiveMembers(packagedArchive)
    expect(Object.keys(files).toSorted(byName)).toEqual(
      vendor.files
        .map((file) => file.path)
        .filter((name) => name !== 'LICENSE')
        .toSorted(byName),
    )
  })

  it('installs byte-identical from the archive', async () => {
    const area = installArea()
    try {
      const result = await install(area)
      expect(result.failure).toBeUndefined()
      expect(result.installed.toSorted(byName)).toEqual([
        'feature_delivery',
        'project_setup',
        'quality_retrofit',
      ])
      const fromArchive = installedTree(area.sourcesRoot)
      // The marker aside, the archive stages every byte the loose tree
      // holds: the loose LICENSE and VENDOR.json plus every member.
      const expected = treeBytes(looseVendor)
      expect(sortedKeys(fromArchive)).toEqual(sortedKeys(expected))
      for (const [name, bytes] of Object.entries(expected)) {
        expect(fromArchive[name]).toEqual(bytes)
      }
    } finally {
      area.cleanup()
    }
  })

  it('a damaged member refuses as a damaged tree does', async () => {
    const area = installArea()
    try {
      const rigArchive = path.join(path.dirname(area.vendorRoot), BUNDLED_SKILLS_ARCHIVE_FILE)
      damageSolidArchiveMember(
        rigArchive,
        'skills/project_setup/SKILL.md',
        BUNDLED_SKILLS_ARCHIVE_VERSION,
      )
      const result = await install(area)
      expect(result.failure).toBeDefined()
      expect(result.failure?.reason.kind).toBe('error')
      expect(existsSync(path.join(area.sourcesRoot, PACKAGE))).toBe(false)
    } finally {
      area.cleanup()
    }
  })

  it('the skill listing from a packed install is unchanged, and damage warns', async () => {
    const loose = await loadSkills(
      { io: fileContextIo, platform: process.platform },
      rootsFor(looseVendor),
    )
    expect(loose.warnings).toEqual([])
    const packed = await loadSkills(
      {
        io: withBundledSkillsArchive(fileContextIo, packagedVendor, process.platform),
        platform: process.platform,
      },
      rootsFor(packagedVendor),
    )
    expect(packed.warnings).toEqual([])
    expect(packed.skills.map((skill) => skill.id)).toEqual(loose.skills.map((skill) => skill.id))
    expect(packed.skills.length).toBeGreaterThan(0)
    for (const skill of packed.skills) {
      const looseBody = loose.skills.find((candidate) => candidate.id === skill.id)?.body
      expect(skill.body).toBe(looseBody)
    }
    const rig = copyRig(packagedParent)
    try {
      const vendorRoot = path.join(rig.dir, PACKAGE)
      const rigArchive = path.join(rig.dir, BUNDLED_SKILLS_ARCHIVE_FILE)
      damageSolidArchiveBytes(rigArchive)
      const refused = await loadSkills(
        {
          io: withBundledSkillsArchive(fileContextIo, vendorRoot, process.platform),
          platform: process.platform,
        },
        rootsFor(vendorRoot),
      )
      expect(refused.skills).toEqual([])
      expect(refused.warnings.length).toBeGreaterThan(0)
    } finally {
      rig.cleanup()
    }
  })

  it('loads a packed install reached through a link to its own folder', async () => {
    // A symlinked ancestor of the install root itself (a linked
    // extensions or storage folder): the roots name the linked spelling
    // while the link check compares the canonical one, so every skill
    // loads with no warning. A junction on Windows, where a directory
    // link needs no privilege.
    const realBase = mkdtempSync(path.join(tmpdir(), 'muse-skill-link-real-'))
    const linkBase = `${realBase}-link`
    symlinkSync(realBase, linkBase, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const linkedParent = path.join(linkBase, 'packaged')
      const vendorRoot = path.join(linkedParent, PACKAGE)
      mkdirSync(vendorRoot, { recursive: true })
      for (const name of ['LICENSE', 'VENDOR.json']) {
        cpSync(path.join(packagedVendor, name), path.join(vendorRoot, name))
      }
      cpSync(packagedArchive, path.join(linkedParent, BUNDLED_SKILLS_ARCHIVE_FILE))
      const packed = await loadSkills(
        {
          io: withBundledSkillsArchive(fileContextIo, vendorRoot, process.platform),
          platform: process.platform,
        },
        rootsFor(vendorRoot),
      )
      expect(packed.warnings).toEqual([])
      const loose = await loadSkills(
        { io: fileContextIo, platform: process.platform },
        rootsFor(looseVendor),
      )
      expect(packed.skills.map((skill) => skill.id)).toEqual(loose.skills.map((skill) => skill.id))
      for (const skill of packed.skills) {
        const looseBody = loose.skills.find((candidate) => candidate.id === skill.id)?.body
        expect(skill.body).toBe(looseBody)
      }
      // The plain loader over a linked folder reads the same way: both
      // sides of its link check canonicalise together.
      const linkedLoose = path.join(linkBase, 'loose')
      cpSync(looseVendor, linkedLoose, { recursive: true })
      const plain = await loadSkills(
        { io: fileContextIo, platform: process.platform },
        rootsFor(linkedLoose),
      )
      expect(plain.warnings).toEqual([])
      expect(plain.skills.map((skill) => skill.id)).toEqual(loose.skills.map((skill) => skill.id))
    } finally {
      rmSync(linkBase, { force: true })
      rmSync(realBase, { recursive: true, force: true })
    }
  })

  it('still refuses a skill that is a link leading outside the tree', async () => {
    // A link INSIDE the tree still refuses exactly that skill: the rest
    // load, and the warning names the refusal. A junction on Windows,
    // where a link needs no privilege.
    const area = mkdtempSync(path.join(tmpdir(), 'muse-skill-link-inside-'))
    try {
      const vendorRoot = path.join(area, PACKAGE)
      cpSync(looseVendor, vendorRoot, { recursive: true })
      const outside = path.join(area, 'outside', 'project_setup')
      mkdirSync(outside, { recursive: true })
      cpSync(
        path.join(looseVendor, 'skills/project_setup/SKILL.md'),
        path.join(outside, 'SKILL.md'),
      )
      rmSync(path.join(vendorRoot, 'skills/project_setup'), { recursive: true })
      symlinkSync(
        outside,
        path.join(vendorRoot, 'skills/project_setup'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const loaded = await loadSkills(
        {
          io: withBundledSkillsArchive(fileContextIo, vendorRoot, process.platform),
          platform: process.platform,
        },
        rootsFor(vendorRoot),
      )
      expect(loaded.skills.map((skill) => skill.id)).toEqual([
        'feature_delivery',
        'quality_retrofit',
      ])
      expect(loaded.warnings).toHaveLength(1)
      expect(loaded.warnings[0]).toContain(
        'bundled skill project_setup skipped: SKILL.md is refused',
      )
      expect(loaded.warnings[0]).toContain('leads outside the workspace through a link')
    } finally {
      rmSync(area, { recursive: true, force: true })
    }
  })
})
