import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assertArchiveChecksum, assertArchivePath } from '../../scripts/sync-bundled-skills.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../vendor/high-quality-projects-skill')
const manifest = z
  .object({
    source: z.literal('https://github.com/RandyNorthrup/high-quality-projects-skill'),
    tag: z.literal('v0.7.0'),
    archiveSha256: z.string().regex(/^[\da-f]{64}$/),
    files: z.array(z.string()).nonempty(),
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
    expect(manifest.files).toEqual(present)
    expect(manifest.files).toEqual(
      [...new Set(manifest.files)].toSorted((a, b) => a.localeCompare(b, 'en')),
    )
  })

  it.each(['project_setup', 'feature_delivery', 'quality_retrofit'])(
    'ships the complete %s skill entry',
    (id) => {
      const skill = `skills/${id}/SKILL.md`
      expect(manifest.files).toContain(skill)
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
