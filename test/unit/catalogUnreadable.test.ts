import type { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ContextIo } from '../../src/core/context/contextFiles'
import { isCodedError } from '../../src/core/context/contextFiles'
import { loadCatalogFiles } from '../../src/core/context/catalogFiles'

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/** The context port backed by the real file system: real reads, real failures. */
const realIo: ContextIo = {
  readFile: async (absolutePath, maxBytes) => {
    let handle: Buffer
    try {
      handle = await readFile(absolutePath)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    return maxBytes === undefined ? handle : handle.subarray(0, maxBytes + 1)
  },
  listDirectory: async (absolutePath) => {
    let entries: { name: string }[]
    try {
      entries = await readdir(absolutePath, { withFileTypes: true })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    return entries.map((entry) => entry.name)
  },
  realPath: (absolutePath) => realpath(absolutePath),
}

const kind = { kind: 'skill', fileName: 'SKILL.md', maxBytes: 1024 * 1024, idPattern: /^[a-z]+$/ }

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-catalog-unreadable-'))
  roots.push(root)
  return root
}

describe('isCodedError', () => {
  it('takes a shaped store failure and nothing else', () => {
    const coded = new Error('gone') as Error & { code: string }
    coded.code = 'ENOENT'
    expect(isCodedError(coded)).toBe(true)
    expect(isCodedError(new Error('plain'))).toBe(false)
    expect(isCodedError('ENOENT')).toBe(false)
    expect(isCodedError(undefined)).toBe(false)
    expect(isCodedError({ code: 42 })).toBe(false)
  })
})

describe('unreadable catalog entries', () => {
  it('refuses an entry it cannot read, in fixed words without the errno', async () => {
    const root = await freshRoot()
    await mkdir(path.join(root, 'skills', 'good'), { recursive: true })
    await writeFile(path.join(root, 'skills', 'good', 'SKILL.md'), '# Good\n', 'utf8')
    // A directory where the entry file belongs: reading it fails shaped.
    await mkdir(path.join(root, 'skills', 'blocked', 'SKILL.md'), { recursive: true })
    const load = await loadCatalogFiles(
      { io: realIo, platform: process.platform },
      [{ directory: path.join(root, 'skills'), source: 'test', confineTo: undefined }],
      kind,
      (text) =>
        text.includes('# Good')
          ? { ok: true, name: 'good', entry: { name: 'good' } }
          : { ok: false, reason: 'bad' },
    )
    expect(load.entries.map((entry) => entry.id)).toEqual(['good'])
    expect(load.roots[0]?.listingFailure).toBeUndefined()
    const refused = load.roots[0]?.refused ?? []
    expect(refused.map((entry) => entry.id)).toEqual(['blocked'])
    expect(load.warnings).toEqual([expect.stringContaining('could not be read')])
    expect(load.warnings.join('\n')).not.toContain('EISDIR')
  })

  it('fails a listing it cannot read, in fixed words without the errno', async () => {
    const root = await freshRoot()
    const blocker = path.join(root, 'blocker')
    await writeFile(blocker, 'in the way', 'utf8')
    const load = await loadCatalogFiles(
      { io: realIo, platform: process.platform },
      [{ directory: blocker, source: 'test', confineTo: undefined }],
      kind,
      (text) => ({ ok: false, reason: text }),
    )
    expect(load.entries).toEqual([])
    expect(load.roots[0]?.listingFailure).toBe('could not be listed')
    expect(load.warnings.join('\n')).not.toContain('ENOTDIR')
  })
})
