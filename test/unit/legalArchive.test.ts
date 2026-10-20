// VSIXFIT A: the solid brotli archive of the pinned legal texts. The real
// producer packs the real pinned files into a real stage; the real loader
// reads every template from the archive byte-for-byte and the scanner
// loads every template from it; a damaged archive and a damaged member
// each fail closed, naming the unreadable member.
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SPDX_TEMPLATE_FILES } from '../../src/core/legal/data'
import { loadLicenseTemplates } from '../../src/core/legal/licenseTemplates'
import { readPinnedLegalData } from '../../src/core/legal/workspace'
import {
  LEGAL_DATA_ARCHIVE_FILE,
  LEGAL_DATA_ARCHIVE_VERSION,
  packLegalDataArchive,
} from '../../scripts/lib/legalArchive.mjs'

const PINNED = path.resolve('src/core/legal/legal-data')
const WORDS = ['equivalentwords.txt', 'slot-words.txt']
const TEMPLATE_IDS = SPDX_TEMPLATE_FILES.filter((file) => file.kind === 'template').map((file) =>
  path.posix.basename(file.path, '.template.txt'),
)
const MEMBER_PATHS = [
  ...WORDS,
  ...SPDX_TEMPLATE_FILES.filter((file) => file.kind === 'template').map((file) => file.path),
]

const byId = (left: string, right: string): number => left.localeCompare(right, 'en')

const root = mkdtempSync(path.join(tmpdir(), 'muse-legal-archive-'))
const stagedLegalDir = path.join(root, 'stage', 'dist', 'legal-data')
const stagedArchive = path.join(root, 'stage', LEGAL_DATA_ARCHIVE_FILE)

beforeAll(() => {
  // A real packed stage: the pinned files plus the loose attribution,
  // packed by the real producer at production quality.
  const loose = path.join(root, 'stage', 'dist', 'legal-data')
  cpSync('src/core/legal/data/NOTICE.md', path.join(loose, 'NOTICE.md'))
  cpSync('src/core/legal/data/provenance.json', path.join(loose, 'provenance.json'))
  cpSync(PINNED, loose, { recursive: true })
  packLegalDataArchive(path.join(root, 'stage'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A private copy of the packed stage whose archive the test then damages. */
function damagedStage(): string {
  const copy = mkdtempSync(path.join(root, 'damaged-'))
  rmSync(copy, { recursive: true, force: true })
  cpSync(path.join(root, 'stage'), copy, { recursive: true })
  return copy
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((member: unknown) => typeof member === 'string')
  )
}

function archiveJson(stage: string): Record<string, string> {
  const packed = readFileSync(path.join(stage, LEGAL_DATA_ARCHIVE_FILE))
  const parsed: unknown = JSON.parse(brotliDecompressSync(packed).toString('utf8'))
  const files: unknown =
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
  if (!isStringRecord(files)) throw new Error('Test archive is malformed')
  return files
}

describe('packaged legal-data archive', () => {
  it('ships the archive beside two loose attribution files', () => {
    expect(existsSync(stagedArchive)).toBe(true)
    expect(existsSync(path.join(stagedLegalDir, 'NOTICE.md'))).toBe(true)
    expect(existsSync(path.join(stagedLegalDir, 'provenance.json'))).toBe(true)
    expect(existsSync(path.join(stagedLegalDir, 'templates'))).toBe(false)
    expect(existsSync(path.join(stagedLegalDir, 'equivalentwords.txt'))).toBe(false)
  })

  it('round-trips every pinned member byte-for-byte from the archive', () => {
    for (const member of MEMBER_PATHS) {
      const expected = readFileSync(path.join(PINNED, ...member.split('/')))
      expect(Buffer.from(readPinnedLegalData(member, stagedLegalDir) ?? [])).toEqual(expected)
    }
  })

  it('loads every template from the archive with no problems', () => {
    const set = loadLicenseTemplates(stagedLegalDir)
    expect(set.problems).toEqual([])
    expect(set.templates.map((template) => template.id).toSorted(byId)).toEqual(
      TEMPLATE_IDS.toSorted(byId),
    )
  })

  it('a damaged archive fails closed', () => {
    const stage = damagedStage()
    try {
      const archive = path.join(stage, LEGAL_DATA_ARCHIVE_FILE)
      const packed = readFileSync(archive)
      const last = packed.at(-1)
      expect(last).toBeDefined()
      packed.writeUInt8((last ?? 0) ^ 0xff, packed.length - 1)
      writeFileSync(archive, packed)
      expect(
        readPinnedLegalData('templates/MIT.template.txt', path.join(stage, 'dist', 'legal-data')),
      ).toBeUndefined()
      const set = loadLicenseTemplates(path.join(stage, 'dist', 'legal-data'))
      expect(set.templates).toEqual([])
      expect(set.problems.length).toBeGreaterThan(0)
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  })

  it('a damaged member fails closed while the other templates load', () => {
    const stage = damagedStage()
    try {
      const parsed = archiveJson(stage)
      const victim = 'templates/GPL-3.0-only.template.txt'
      const original = parsed[victim] ?? ''
      parsed[victim] = `X${original.slice(1)}`
      const repacked = brotliCompressSync(
        JSON.stringify({ version: LEGAL_DATA_ARCHIVE_VERSION, files: parsed }),
        {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
        },
      )
      writeFileSync(path.join(stage, LEGAL_DATA_ARCHIVE_FILE), repacked)
      const legalDir = path.join(stage, 'dist', 'legal-data')
      const damaged = readPinnedLegalData(victim, legalDir)
      expect(damaged).toBeDefined()
      expect(Buffer.from(damaged ?? [])).not.toEqual(
        readFileSync(path.join(PINNED, ...victim.split('/'))),
      )
      const set = loadLicenseTemplates(legalDir)
      expect(set.problems).toContain(victim)
      expect(set.templates.map((template) => template.id)).toContain('MIT')
      expect(set.templates.map((template) => template.id)).not.toContain('GPL-3.0-only')
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  })
})
