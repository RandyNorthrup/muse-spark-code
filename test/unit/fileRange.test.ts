import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeWindow, executeTool, type ToolContext } from '../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../src/host/backend/toolIo'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { TOOL_FILE_MAX_BYTES } from '../../src/shared/constants'

// A9 (limits-output): files of any size read and edit by byte range.
// Real files in a real temp folder through the real IO and tool layers:
// paths in, windowed text and edited bytes out.
const root = mkdtempSync(path.join(tmpdir(), 'limits-a9-'))
mkdirSync(path.join(root, 'sub'), { recursive: true })
const big = path.join(root, 'big.txt')

function context(): {
  ctx: ToolContext
  seen: Map<string, string>
  run: (name: string, args: unknown) => Promise<{ output: string; failure?: string }>
} {
  const io = createToolIo({
    platform: process.platform,
    listFiles: () => Promise.resolve([]),
    systemRoot: undefined,
    env: () => ({}),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
  const seen = new Map<string, string>()
  const provisionalSeen = new Map<string, string>()
  const ctx: ToolContext = {
    workspaceRoot: root,
    platform: process.platform,
    io,
    seen,
    provisionalSeen,
  }
  return {
    ctx,
    seen,
    run: async (name: string, args: unknown) => {
      const outcome = await executeTool(name, JSON.stringify(args), ctx)
      for (const [absolute, hash] of provisionalSeen) seen.set(absolute, hash)
      provisionalSeen.clear()
      return { output: outcome.output, failure: outcome.failureReason }
    },
  }
}

function line(number_: number): string {
  return `line ${String(number_).padStart(6, '0')} ${'x'.repeat(90)}\n`
}

beforeAll(() => {
  let text = ''
  for (let index = 1; index <= 115_000; index += 1) {
    text += line(index)
  }
  writeFileSync(big, text)
  expect(text.length).toBeGreaterThan(TOOL_FILE_MAX_BYTES)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('byte windows', () => {
  it('decodes edge-trimmed slices and refuses non-text', () => {
    const bytes = new TextEncoder().encode('aé😀z')
    // 'é' is bytes 1-2, '😀' bytes 3-6.
    expect(decodeWindow(bytes, 0, 1)).toBe('a')
    expect(decodeWindow(bytes, 1, 3)).toBe('é')
    expect(decodeWindow(bytes, 2, 7)).toBe('😀')
    expect(decodeWindow(bytes, 3, 7)).toBe('😀')
    expect(decodeWindow(bytes, 3, 8)).toBe('😀z')
    expect(decodeWindow(new Uint8Array([0x61, 0x00, 0x62]), 0, 3)).toBeUndefined()
    expect(decodeWindow(new Uint8Array([0xff, 0xfe]), 0, 2)).toBeUndefined()
    // The BOM is kept as a character, like whole reads: the display strips it.
    expect(decodeWindow(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]), 0, 5)).toBe('\u{FEFF}hi')
  })

  it('reads an over-cap file window by window to the end', async () => {
    const { run } = context()
    const first = await run('read_file', { path: 'big.txt', byteOffset: 0, byteLength: 100 })
    expect(first.failure).toBeUndefined()
    expect(first.output).toContain('bytes 0–100 of')
    expect(first.output).toContain('call read_file again with byteOffset 100 for the rest')
    expect(first.output).toContain('line 000001')
    const size = Number(/of (\d+)\):/.exec(first.output)?.[1])
    expect(size).toBeGreaterThan(TOOL_FILE_MAX_BYTES)
    const last = await run('read_file', {
      path: 'big.txt',
      byteOffset: size - 100,
      byteLength: 100,
    })
    expect(last.failure).toBeUndefined()
    expect(last.output).toContain('end of file')
    expect(last.output).toContain('115000')
  })

  it('refuses past-end offsets, mixed addressing and oversized windows', async () => {
    const { run } = context()
    const past = await run('read_file', { path: 'big.txt', byteOffset: 999_999_999 })
    expect(past.failure).toContain('past the end')
    const mixed = await run('read_file', { path: 'big.txt', offset: 1, byteOffset: 0 })
    expect(mixed.failure).toContain('either line addressing')
    const wide = await run('read_file', {
      path: 'big.txt',
      byteOffset: 0,
      byteLength: 2 * 1024 * 1024,
    })
    expect(wide.failure).toContain('at most')
  })

  it('refuses a line-mode read past the cap with the byte way instead', async () => {
    const { run } = context()
    const refused = await run('read_file', { path: 'big.txt' })
    expect(refused.failure).toContain('whole-read limit')
    expect(refused.failure).toContain('byteOffset 0')
  })

  it('reports a missing file instead of an empty window', async () => {
    const { run } = context()
    const missing = await run('read_file', { path: 'nope.txt', byteOffset: 0 })
    expect(missing.failure).toContain('file not found')
    const emptyPath = path.join(root, 'empty.txt')
    writeFileSync(emptyPath, '')
    const empty = await run('read_file', { path: 'empty.txt', byteOffset: 0 })
    expect(empty.failure).toBeUndefined()
    expect(empty.output).toContain('the file is empty')
    const binary = path.join(root, 'binary.bin')
    writeFileSync(binary, Buffer.from([0x61, 0x00, 0x62]))
    await expect(run('read_file', { path: 'binary.bin', byteOffset: 0 })).rejects.toThrow()
  })
})

describe('range edits', () => {
  it('refuses a concurrent change since the range was read', async () => {
    const target = path.join(root, 'stale.txt')
    writeFileSync(target, 'abc')
    const { run } = context()
    await run('read_file', { path: 'stale.txt', byteOffset: 0, byteLength: 3 })
    writeFileSync(target, 'abc changed by the person')
    const result = await run('edit_file', {
      path: 'stale.txt',
      find: 'abc',
      replace: 'ABC',
      byteOffset: 0,
      byteLength: 3,
    })
    expect(result.failure).toBeDefined()
    expect(readFileSync(target, 'utf8')).toBe('abc changed by the person')
  })
  it('cannot replace a character whose leading byte is outside the window', async () => {
    const target = path.join(root, 'partial.txt')
    writeFileSync(target, 'éA')
    const { run } = context()
    await run('read_file', { path: 'partial.txt', byteOffset: 1, byteLength: 2 })
    const result = await run('edit_file', {
      path: 'partial.txt',
      find: 'é',
      replace: 'X',
      byteOffset: 1,
      byteLength: 2,
    })
    expect(result.failure).toBeDefined()
    expect(readFileSync(target)).toEqual(Buffer.from('éA'))
  })

  it('preserves bytes outside a window split between CR and LF', async () => {
    const target = path.join(root, 'split-crlf.txt')
    writeFileSync(target, '\u{FEFF}a\r\nb\r\nc\r\n')
    const { run } = context()
    await run('read_file', { path: 'split-crlf.txt', byteOffset: 5, byteLength: 3 })
    const result = await run('edit_file', {
      path: 'split-crlf.txt',
      find: 'b',
      replace: 'B',
      byteOffset: 5,
      byteLength: 3,
    })
    expect(result.failure).toBeUndefined()
    expect(readFileSync(target)).toEqual(Buffer.from('\u{FEFF}a\r\nB\r\nc\r\n'))
  })
  it('replaces inside the window and fingerprints the whole new text', async () => {
    const target = path.join(root, 'edit.txt')
    writeFileSync(target, readFileSync(big))
    const { seen, run } = context()
    await run('read_file', { path: 'edit.txt', byteOffset: 0, byteLength: 65_536 })
    const edited = await run('edit_file', {
      path: 'edit.txt',
      find: 'line 000002',
      replace: 'line 000002 edited',
      byteOffset: 0,
      byteLength: 65_536,
    })
    expect(edited.failure).toBeUndefined()
    expect(edited.output).toContain('edited edit.txt (bytes 0–65536)')
    const final = readFileSync(target, 'utf8')
    expect(final).toContain('line 000002 edited')
    expect(final).not.toContain('line 000002 x')
    const absolute = path.join(root, 'edit.txt')
    expect(seen.get(absolute)).toBe(fingerprint(final))
    expect(createHash('sha256').update(final).digest('hex')).toBe(fingerprint(final))
  })

  it('refuses a match outside the window and an ambiguous whole file', async () => {
    const target = path.join(root, 'scoped.txt')
    writeFileSync(target, 'aaa needle bbb\nccc needle ddd\n')
    const { run } = context()
    await run('read_file', { path: 'scoped.txt', byteOffset: 0, byteLength: 10 })
    const outside = await run('edit_file', {
      path: 'scoped.txt',
      find: 'ddd',
      replace: 'DDD',
      byteOffset: 0,
      byteLength: 10,
    })
    expect(outside.failure).toContain('outside the read window')
    expect(readFileSync(target, 'utf8')).toContain('ddd')
    const ambiguous = await run('edit_file', {
      path: 'scoped.txt',
      find: 'needle',
      replace: 'NEEDLE',
      byteOffset: 0,
      byteLength: 10,
    })
    expect(ambiguous.failure).toBeDefined()
    expect(readFileSync(target, 'utf8')).not.toContain('NEEDLE')
  })

  it('keeps CRLF breaks and strips a leading BOM for the window', async () => {
    const crlf = path.join(root, 'crlf.txt')
    writeFileSync(crlf, 'a\r\nb\r\n')
    const { run } = context()
    const shown = await run('read_file', { path: 'crlf.txt', byteOffset: 0, byteLength: 100 })
    expect(shown.output).toContain('a\nb\n')
    const edited = await run('edit_file', {
      path: 'crlf.txt',
      find: 'b',
      replace: 'B',
      byteOffset: 0,
      byteLength: 100,
    })
    expect(edited.failure).toBeUndefined()
    expect(readFileSync(crlf)).toEqual(Buffer.from('a\r\nB\r\n'))
    const bom = path.join(root, 'bom.txt')
    writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello\n')]))
    const bomShown = await run('read_file', { path: 'bom.txt', byteOffset: 0, byteLength: 100 })
    expect(bomShown.output).toContain('\nhello\n')
    const bomEdited = await run('edit_file', {
      path: 'bom.txt',
      find: 'hello',
      replace: 'hi',
      byteOffset: 0,
      byteLength: 100,
    })
    expect(bomEdited.failure).toBeUndefined()
    expect([...readFileSync(bom)]).toEqual([0xef, 0xbb, 0xbf, ...Buffer.from('hi\n')])
  })
})
