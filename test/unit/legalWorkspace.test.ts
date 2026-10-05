import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLegalSnapshot } from '../../src/core/legal/workspace'
import { scanLegal } from '../../src/core/legal/scan'
import {
  LEGAL_FILES_SCANNED_MAX,
  LEGAL_FINDINGS_MAX,
  LEGAL_TEXT_MAX_CHARS,
} from '../../src/shared/constants'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  }
})

const roots: string[] = []
function fixture(): string {
  const parent = fileURLToPath(new URL('../../temp/', import.meta.url))
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'm97-workspace-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT License\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"license":"MIT"}')
  fs.writeFileSync(path.join(root, 'payload.gemspec'), 'system("touch PWNED")\n')
  return root
}
function tree(root: string): string[] {
  const result: string[] = []
  function walk(dir: string, local: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const name = `${local}/${entry.name}`
      if (entry.isDirectory()) {
        result.push(`${name}:directory`)
        walk(absolute, name)
      } else if (entry.isSymbolicLink()) result.push(`${name}:link:${fs.readlinkSync(absolute)}`)
      else
        result.push(
          `${name}:file:${createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`,
        )
    }
  }
  walk(root, '')
  return result.toSorted((a, b) => a.localeCompare(b, 'en'))
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('legal workspace admission', () => {
  it('reads only O_RDONLY descriptors and leaves paths, types and bytes unchanged', () => {
    const root = fixture()
    const before = tree(root)
    const snapshot = createLegalSnapshot(root)
    vi.mocked(fs.writeFileSync).mockClear()
    vi.mocked(fs.openSync).mockClear()
    scanLegal(snapshot, { headerPolicy: 'required' })
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(fs.openSync).toHaveBeenCalled()
    for (const call of vi.mocked(fs.openSync).mock.calls)
      expect(call[1]).toBe(
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          (Object.hasOwn(fs.constants, 'O_NONBLOCK') ? fs.constants.O_NONBLOCK : 0),
      )
    expect(tree(root)).toEqual(before)
  })

  it('rejects external links, directory links and a leaf replaced after enumeration before reading bytes', () => {
    const root = fixture()
    const outside = fixture()
    fs.symlinkSync(path.join(outside, 'LICENSE'), path.join(root, 'COPYING'))
    fs.symlinkSync(outside, path.join(root, 'linked-directory'))
    const snapshot = createLegalSnapshot(root)
    expect(snapshot.files).not.toContain('COPYING')
    expect(snapshot.files.some((path) => path.startsWith('linked-directory/'))).toBe(false)
    expect(snapshot.incompleteChecks.join(' ')).toContain('link')
    fs.unlinkSync(path.join(root, 'LICENSE'))
    fs.symlinkSync(path.join(outside, 'LICENSE'), path.join(root, 'LICENSE'))
    vi.mocked(fs.readSync).mockClear()
    expect(snapshot.readFile('LICENSE')).toBeUndefined()
    expect(fs.readSync).not.toHaveBeenCalled()
    expect(() => snapshot.readFile('../LICENSE')).toThrow()
  })

  it('reports undecodable UTF-16 and missing/unreadable text rather than inventing evidence', () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'broken.ts'), Buffer.from([255, 254, 65, 0]))
    const snapshot = createLegalSnapshot(root)
    expect(snapshot.readFile('broken.ts')).toBeUndefined()
    expect(scanLegal(snapshot, { headerPolicy: 'required' }).incompleteChecks.join(' ')).toContain(
      'broken.ts',
    )
  })

  it('rejects a different native file held by the descriptor before reading any bytes', () => {
    const root = fixture()
    const other = fixture()
    const snapshot = createLegalSnapshot(root)
    const held = fs.openSync(path.join(other, 'LICENSE'), fs.constants.O_RDONLY)
    vi.mocked(fs.openSync).mockReturnValueOnce(held)
    vi.mocked(fs.readSync).mockClear()
    expect(snapshot.readFile('LICENSE')).toBeUndefined()
    expect(fs.readSync).not.toHaveBeenCalled()
  })

  it('refuses to open a regular file replaced after enumeration', () => {
    const root = fixture()
    const snapshot = createLegalSnapshot(root)
    fs.renameSync(path.join(root, 'LICENSE'), path.join(root, 'old-license'))
    fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT License\n')
    vi.mocked(fs.openSync).mockClear()
    expect(snapshot.readFile('LICENSE')).toBeUndefined()
    expect(fs.openSync).not.toHaveBeenCalled()
  })

  it('refuses a parent directory changed to an escaping link even when the leaf has the same identity', () => {
    const root = fixture()
    const other = fixture()
    fs.mkdirSync(path.join(root, 'nested'))
    fs.writeFileSync(path.join(root, 'nested', 'LICENSE'), 'MIT License\n')
    fs.linkSync(path.join(root, 'nested', 'LICENSE'), path.join(other, 'nested-license'))
    const snapshot = createLegalSnapshot(root)
    fs.renameSync(path.join(root, 'nested'), path.join(root, 'old-nested'))
    fs.mkdirSync(path.join(other, 'nested'))
    fs.renameSync(path.join(other, 'nested-license'), path.join(other, 'nested', 'LICENSE'))
    fs.symlinkSync(path.join(other, 'nested'), path.join(root, 'nested'))
    vi.mocked(fs.openSync).mockClear()
    expect(snapshot.readFile('nested/LICENSE')).toBeUndefined()
    expect(fs.openSync).not.toHaveBeenCalled()
  })

  it('refuses oversized files before reading them', () => {
    const root = fixture()
    fs.writeFileSync(
      path.join(root, 'large.ts'),
      'x'.repeat(LEGAL_TEXT_MAX_CHARS * LEGAL_FINDINGS_MAX + 1),
    )
    const snapshot = createLegalSnapshot(root)
    vi.mocked(fs.readSync).mockClear()
    expect(snapshot.readFile('large.ts')).toBeUndefined()
    expect(fs.readSync).not.toHaveBeenCalled()
  })

  it('discards text changed while the descriptor is being read', () => {
    const root = fixture()
    const snapshot = createLegalSnapshot(root)
    vi.mocked(fs.readSync).mockImplementationOnce((...args) => {
      const count = fs.readSync(...args)
      fs.writeFileSync(path.join(root, 'LICENSE'), 'Changed terms after read\n')
      return count
    })
    expect(snapshot.readFile('LICENSE')).toBeUndefined()
  })

  it('stops directories with too many entries and reports the enumeration limit', () => {
    const root = fixture()
    const fake = Array.from({ length: LEGAL_FILES_SCANNED_MAX + 1 }, (_, index) =>
      Object.assign(new fs.Dirent(), { name: `file${String(index)}` }),
    )
    const directory = fs.opendirSync(root)
    vi.spyOn(directory, 'readSync').mockImplementation(() => fake.shift() ?? null)
    const close = vi.spyOn(directory, 'closeSync')
    const spy = vi.spyOn(fs, 'opendirSync').mockReturnValue(directory)
    try {
      const snapshot = createLegalSnapshot(root)
      expect(snapshot.files).toEqual([])
      expect(snapshot.incompleteChecks.join(' ')).toContain('budget reached')
      expect(close).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('cancels without modifying the complete tree and preserves bytes on an error', () => {
    const root = fixture()
    const before = tree(root)
    const controller = new AbortController()
    const snapshot = createLegalSnapshot(root, controller.signal)
    controller.abort()
    expect(() => snapshot.readFile('LICENSE')).toThrow('cancelled')
    expect(() =>
      scanLegal(snapshot, { headerPolicy: 'required', signal: controller.signal }),
    ).toThrow('cancelled')
    expect(() => createLegalSnapshot(root, controller.signal)).toThrow('cancelled')
    expect(() =>
      scanLegal({ files: ['../bad'], readFile: () => 'bad' }, { headerPolicy: 'off' }),
    ).toThrow()
    expect(tree(root)).toEqual(before)
  })
})
