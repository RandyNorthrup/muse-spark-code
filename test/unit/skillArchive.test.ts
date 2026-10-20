// VSIXWEB B: the vendored skill package's solid archive. The real
// producer packs the real vendored tree into a real archive, keeping
// LICENSE and VENDOR.json loose; the real installer stages byte-identical
// from the archive, and a damaged member refuses as a damaged tree does.
// The real skill loader lists the same skills through the archive-backed
// reader as through the loose tree, and a damaged archive warns instead of
// failing the turn.
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { withBundledSkillsArchive } from '../../src/core/context/bundledSkillsArchive'
import { bundledSkillsRoot, loadSkills, type SkillRoot } from '../../src/core/context/skills'
import { installBundledSkills } from '../../src/host/skills/bundledSkillsInstall'
import { BUNDLED_SKILLS_ARCHIVE_FILE } from '../../src/shared/constants'
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

function isRecord(value: unknown): value is Record<string, { sha256: string; text: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (member: unknown) =>
        typeof member === 'object' &&
        member !== null &&
        typeof Reflect.get(member, 'sha256') === 'string' &&
        typeof Reflect.get(member, 'text') === 'string',
    )
  )
}

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
  const stage = path.join(root, 'stage')
  cpSync(VENDOR, path.join(stage, 'vendor', PACKAGE), { recursive: true })
  const packed = packSolidTextArchive(
    stage,
    `vendor/${PACKAGE}`,
    `vendor/${BUNDLED_SKILLS_ARCHIVE_FILE}`,
    new Set(['LICENSE', 'VENDOR.json']),
  )
  expect(packed.members).toBeGreaterThan(0)
  mkdirSync(packagedParent, { recursive: true })
  cpSync(path.join(stage, 'vendor', PACKAGE), packagedVendor, { recursive: true })
  cpSync(path.join(stage, 'vendor', BUNDLED_SKILLS_ARCHIVE_FILE), packagedArchive)
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
    const parsed: unknown = JSON.parse(
      brotliDecompressSync(readFileSync(packagedArchive)).toString('utf8'),
    )
    const files: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
    if (!isRecord(files)) throw new Error('Test archive is malformed')
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
      const result = await installBundledSkills({
        vendorRoot: area.vendorRoot,
        skillsRoot: area.skillsRoot,
        sourcesRoot: area.sourcesRoot,
        platform: process.platform,
        now: () => Date.now(),
        newId: () => 'testid',
      })
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
      const parsed: unknown = JSON.parse(
        brotliDecompressSync(readFileSync(rigArchive)).toString('utf8'),
      )
      const files: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
      if (!isRecord(files)) throw new Error('Test archive is malformed')
      const victim = 'skills/project_setup/SKILL.md'
      const original = files[victim]?.text ?? ''
      expect(original.length).toBeGreaterThan(0)
      files[victim] = { sha256: files[victim]?.sha256 ?? '', text: `X${original.slice(1)}` }
      writeFileSync(
        rigArchive,
        brotliCompressSync(JSON.stringify({ version: 1, files }), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
        }),
      )
      const result = await installBundledSkills({
        vendorRoot: area.vendorRoot,
        skillsRoot: area.skillsRoot,
        sourcesRoot: area.sourcesRoot,
        platform: process.platform,
        now: () => Date.now(),
        newId: () => 'testid',
      })
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
    const rig = mkdtempSync(path.join(tmpdir(), 'muse-skill-damaged-'))
    try {
      const vendorRoot = path.join(rig, PACKAGE)
      cpSync(packagedVendor, vendorRoot, { recursive: true })
      const rigArchive = path.join(rig, BUNDLED_SKILLS_ARCHIVE_FILE)
      cpSync(packagedArchive, rigArchive)
      const damaged = readFileSync(rigArchive)
      damaged.writeUInt8((damaged.at(-1) ?? 0) ^ 0xff, damaged.length - 1)
      writeFileSync(rigArchive, damaged)
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
      rmSync(rig, { recursive: true, force: true })
    }
  })
})
