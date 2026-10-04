import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  archiveFiles,
  assertArchiveChecksum,
  assertArchivePath,
  isSelected,
} from '../../scripts/sync-bundled-skills.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../vendor/high-quality-projects-skill')
const manifest = z
  .object({
    source: z.literal('https://github.com/RandyNorthrup/high-quality-projects-skill'),
    tag: z.literal('v0.7.0'),
    archiveSha256: z.string().regex(/^[\da-f]{64}$/),
    files: z
      .array(z.object({ path: z.string(), sha256: z.string().regex(/^[\da-f]{64}$/) }))
      .nonempty(),
  })
  .parse(JSON.parse(readFileSync(path.join(ROOT, 'VENDOR.json'), 'utf8')))

function presentFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`
    return entry.isDirectory()
      ? presentFiles(path.join(directory, entry.name), `${relative}/`)
      : [relative]
  })
}

describe('bundled workflow release', () => {
  it('records exactly the present files, sorted, without the manifest itself', () => {
    const present = presentFiles(ROOT)
      .filter((file) => file !== 'VENDOR.json')
      .toSorted((a, b) => a.localeCompare(b, 'en'))
    const paths = manifest.files.map((file) => file.path)
    expect(paths).toEqual(present)
    expect(paths).toEqual([...new Set(paths)].toSorted((a, b) => a.localeCompare(b, 'en')))
  })

  it.each(manifest.files)('pins the SHA-256 of $path', ({ path: relative, sha256 }) => {
    const bytes = readFileSync(path.join(ROOT, relative))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
  })

  it.each(['project_setup', 'feature_delivery', 'quality_retrofit'])(
    'ships the complete %s skill entry',
    (id) => {
      const skill = `skills/${id}/SKILL.md`
      expect(manifest.files.map((file) => file.path)).toContain(skill)
      expect(readFileSync(path.join(ROOT, skill), 'utf8')).toContain(`name: ${id}`)
    },
  )

  it('ships only workflow assets and top-level documentation', () => {
    const files = presentFiles(ROOT).filter((name) => name !== 'VENDOR.json')
    for (const file of files) {
      expect(file).toMatch(
        /^(?:skills\/|scripts\/|templates\/|docs\/[^/]+\.md$|AGENTS\.md$|LICENSE$|README\.md$)/,
      )
      expect(file).not.toMatch(/^(?:tests\/|docs\/(?:assets|evaluations)\/)/)
      expect(file).not.toBe('scripts/build-release.ps1')
    }
  })
})

describe('vendor copy allow-list', () => {
  it.each([
    ['skills/project_setup/SKILL.md', true],
    ['skills/feature_delivery/references/guide.md', true],
    ['scripts/check.ps1', true],
    ['scripts/helpers/check.py', true],
    ['templates/.pre-commit-config.yaml', true],
    ['AGENTS.md', true],
    ['LICENSE', true],
    ['README.md', true],
    ['docs/DELIVERY.md', true],
    ['scripts/build-release.ps1', false],
    ['docs/assets/image.png', false],
    ['docs/evaluations/report.md', false],
    ['docs/nested/guide.md', false],
    ['docs/guide.txt', false],
    ['tests/guard.test.ts', false],
    ['.github/workflows/ci.yml', false],
    ['requirements.txt', false],
    ['skills-other/SKILL.md', false],
    ['scripts-other/check.py', false],
    ['templates-other/config.yaml', false],
    ['nested/README.md', false],
    ['', false],
  ])('selects %s: %s', (name, included) => {
    expect(isSelected(name)).toBe(included)
  })
})

const TOP_FOLDER = 'high-quality-projects-skill-v0.7.0'
const TAR_BLOCK_BYTES = 512
const REQUIRED_FILES = [
  'LICENSE',
  'skills/project_setup/SKILL.md',
  'skills/feature_delivery/SKILL.md',
  'skills/quality_retrofit/SKILL.md',
]

interface TarEntry {
  name: string
  body?: string
  type?: string
  mode?: number
}

function requiredEntries(): TarEntry[] {
  return REQUIRED_FILES.map((name) => ({ name: `${TOP_FOLDER}/${name}`, body: name }))
}

// Minimal ustar fixture: independently encode the fixed header offsets/checksum.
function tarArchive(entries: TarEntry[]): Buffer {
  const blocks = entries.flatMap(({ name, body = '', type = '0', mode = 0o644 }) => {
    const bytes = Buffer.from(body)
    const header = Buffer.alloc(TAR_BLOCK_BYTES)
    header.write(name, 0, 100)
    header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8)
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12)
    header.fill(' ', 148, 156)
    header.write(type, 156, 1)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    const padding = Buffer.alloc(
      (TAR_BLOCK_BYTES - (bytes.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES,
    )
    return [header, bytes, padding]
  })
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(TAR_BLOCK_BYTES * 2)]))
}

describe('vendor archive reader', () => {
  it('copies only allowed regular files, preserving bytes and executable mode', () => {
    const entries = [
      ...requiredEntries(),
      { name: `${TOP_FOLDER}/skills/`, type: '5' },
      { name: `${TOP_FOLDER}/scripts/check.sh`, body: 'echo ok\n', mode: 0o755 },
      { name: `${TOP_FOLDER}/templates/config.yaml`, body: 'value: true\n' },
      { name: `${TOP_FOLDER}/docs/DELIVERY.md`, body: '# Delivery\n' },
      { name: `${TOP_FOLDER}/scripts/build-release.ps1` },
      { name: `${TOP_FOLDER}/tests/guard.test.ts` },
      { name: `${TOP_FOLDER}/docs/assets/image.png` },
      { name: `${TOP_FOLDER}/docs/evaluations/report.md` },
    ]
    const files = archiveFiles(tarArchive(entries), TOP_FOLDER)
    expect([...files].map(([name]) => name)).toEqual([
      ...REQUIRED_FILES,
      'scripts/check.sh',
      'templates/config.yaml',
      'docs/DELIVERY.md',
    ])
    expect(files.get('scripts/check.sh')).toEqual({ body: Buffer.from('echo ok\n'), mode: 0o755 })
  })

  it.each(REQUIRED_FILES)('refuses a release missing %s', (missing) => {
    const entries = requiredEntries().filter((entry) => entry.name !== `${TOP_FOLDER}/${missing}`)
    expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow(
      `Release is missing ${missing}`,
    )
  })

  it.each([
    ['x', 'Unsupported tar entry'],
    ['K', 'Unsupported tar entry'],
    ['L', 'Unsupported tar entry'],
    ['1', 'Archive links are forbidden'],
    ['2', 'Archive links are forbidden'],
  ])('refuses entry type %s before the copy allow-list', (type, message) => {
    const entries = [...requiredEntries(), { name: `${TOP_FOLDER}/tests/override`, type }]
    expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow(message)
  })

  it('refuses traversal even in an excluded entry', () => {
    const entries = [...requiredEntries(), { name: `${TOP_FOLDER}/tests/../outside` }]
    expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow('Unsafe archive path')
  })

  it('refuses a duplicate entry', () => {
    const entries = [...requiredEntries(), { name: `${TOP_FOLDER}/LICENSE` }]
    expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow('Duplicate archive file')
  })

  it('refuses the wrong top folder even in an excluded entry', () => {
    const entries = [...requiredEntries(), { name: 'wrong-folder/tests/ignored' }]
    expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow('Unexpected archive root')
  })

  it.each([
    'license',
    'LICENSE.',
    'LICENSE ',
    'LICENSE. ',
    'skills/PROJECT_SETUP/SKILL.md',
    'skills/project_setup./SKILL.md',
    'skills/project_setup /SKILL.md',
  ])('refuses filesystem alias %s in either archive order', (alias) => {
    const entry = { name: `${TOP_FOLDER}/${alias}` }
    for (const entries of [
      [...requiredEntries(), entry],
      [entry, ...requiredEntries()],
    ]) {
      expect(() => archiveFiles(tarArchive(entries), TOP_FOLDER)).toThrow('Duplicate archive file')
    }
  })
})

describe('release checksum guard', () => {
  const bytes = new TextEncoder().encode('abc')
  // SHA-256's known "abc" vector, independent of the implementation.
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  const archive = 'high-quality-projects-skill-v0.7.0.tar.gz'

  it('accepts the archive-specific line among other assets, including binary notation', () => {
    expect(
      assertArchiveChecksum(
        bytes,
        `${'0'.repeat(64)}  other.zip\n${digest} *${archive}\r\n`,
        archive,
      ),
    ).toBe(digest)
  })

  it('refuses a mismatching archive checksum', () => {
    expect(() => assertArchiveChecksum(bytes, `${'0'.repeat(64)}  ${archive}\n`, archive)).toThrow(
      'SHA-256 mismatch',
    )
  })

  it.each(['', `${digest}  other.zip`, `${digest}  ${archive}\n${digest}  ${archive}`])(
    'refuses a missing or ambiguous archive line: %s',
    (sums) => {
      expect(() => assertArchiveChecksum(bytes, sums, archive)).toThrow('checksum')
    },
  )
})

describe('archive path guard', () => {
  it('accepts a regular file and directory under the top folder', () => {
    expect(() => {
      assertArchivePath('package/skills/project_setup/SKILL.md', '0')
    }).not.toThrow()
    expect(() => {
      assertArchivePath('package/skills/', '5')
    }).not.toThrow()
  })

  it.each([
    '../x',
    'package/../x',
    '/x',
    'C:/x',
    'C:x',
    String.raw`\\server\x`,
    String.raw`package\..\x`,
    'package/file:stream',
    '',
  ])('refuses unsafe path %s', (name) => {
    expect(() => {
      assertArchivePath(name, '0')
    }).toThrow('Unsafe archive path')
  })

  it.each(['1', '2'])('refuses link type %s even at an otherwise safe path', (type) => {
    expect(() => {
      assertArchivePath('package/skills/link', type)
    }).toThrow('links are forbidden')
  })
})
