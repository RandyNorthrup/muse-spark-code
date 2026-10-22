import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeWindow } from '../../src/core/backends/modelapi/fileRangeTools'
import { executeTool, type ToolContext } from '../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../src/host/backend/toolIo'
import { TOOL_FILE_MAX_BYTES } from '../../src/shared/constants'

// Byte-range file reads and edits: real files in a real temp folder through
// the real IO and tool layers — windowed text in, edited bytes out.
const root = mkdtempSync(path.join(tmpdir(), 'rllimits-range-'))
const small = path.join(root, 'small.txt')
const over = path.join(root, 'over.txt')

function contextFor(): {
  ctx: ToolContext
  seen: Map<string, string>
  run: (name: string, args: unknown) => Promise<{ output: string; failure: string | undefined }>
} {
  const io = createToolIo({
    platform: process.platform,
    listFiles: () => Promise.resolve([]),
    systemRoot: undefined,
    env: () => ({}),
    searchWorkerPath: '',
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

beforeAll(() => {
  writeFileSync(small, 'alpha\nbeta\ngamma\ndelta\n')
  // Just past the whole-read size: the refusal must name the byte window.
  writeFileSync(over, `${'x'.repeat(1024)}\n`.repeat(11 * 1024))
  expect(
    Buffer.byteLength(
      'x'
        .repeat(1024)
        .concat('\n')
        .repeat(11 * 1024),
    ),
  ).toBeGreaterThan(TOOL_FILE_MAX_BYTES)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('decodeWindow', () => {
  it('leaves out a split multi-byte sequence at either edge', () => {
    // 'é' is two bytes in UTF-8; each window edge cuts inside one.
    const bytes = new Uint8Array([0xc3, 0xa9, 0x78, 0xc3, 0xa9])
    expect(decodeWindow(bytes, 0, 1)).toBe('')
    expect(decodeWindow(bytes, 0, 5)).toBe('éxé')
    expect(decodeWindow(bytes, 4, 5)).toBe('')
  })

  it('refuses bytes no text window can show', () => {
    expect(decodeWindow(new Uint8Array([0x61, 0x00, 0x62]), 0, 3)).toBeUndefined()
    expect(decodeWindow(new Uint8Array([0xff, 0xfe]), 0, 2)).toBeUndefined()
  })

  it('keeps a leading byte-order mark as a character', () => {
    expect(decodeWindow(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 0, 4)).toBe('\u{FEFF}a')
  })
})

describe('byte-range read_file', () => {
  it('reads one window and names the next offset', async () => {
    const { run } = contextFor()
    const first = await run('read_file', { path: 'small.txt', byteOffset: 0, byteLength: 8 })
    expect(first.failure).toBeUndefined()
    expect(first.output).toContain('(bytes 0–8 of 23)')
    expect(first.output).toContain('call read_file again with byteOffset 8 for the rest')
    const last = await run('read_file', { path: 'small.txt', byteOffset: 20, byteLength: 64 })
    expect(last.failure).toBeUndefined()
    expect(last.output).toContain('end of file')
  })

  it('refuses mixed line and byte addressing', async () => {
    const { run } = contextFor()
    const outcome = await run('read_file', { path: 'small.txt', offset: 1, byteOffset: 0 })
    expect(outcome.failure).toContain(
      'either line addressing (offset and limit) or byte addressing',
    )
  })

  it('refuses a byte offset past the end with the valid range', async () => {
    const { run } = contextFor()
    const outcome = await run('read_file', { path: 'small.txt', byteOffset: 23 })
    expect(outcome.failure).toContain('byteOffset 23 is past the end')
    expect(outcome.failure).toContain('use an offset from 0 to 22')
  })

  it('refuses a byte length past the one-window cap', async () => {
    const { run } = contextFor()
    const outcome = await run('read_file', {
      path: 'small.txt',
      byteOffset: 0,
      byteLength: 2 * 1024 * 1024,
    })
    expect(outcome.failure).toContain('byteLength holds at most 1048576 bytes')
  })

  it('names the byte window when a whole read would exceed its size', async () => {
    const { run } = contextFor()
    const outcome = await run('read_file', { path: 'over.txt' })
    expect(outcome.failure).toContain('over the')
    expect(outcome.failure).toContain('byteOffset 0 and byteLength')
  })
})

describe('byte-range edit_file', () => {
  it('edits inside the window the model read', async () => {
    const { run, seen } = contextFor()
    writeFileSync(small, 'alpha\nbeta\ngamma\ndelta\n')
    seen.clear()
    const read = await run('read_file', { path: 'small.txt', byteOffset: 0, byteLength: 23 })
    expect(read.failure).toBeUndefined()
    const edited = await run('edit_file', {
      path: 'small.txt',
      find: 'beta',
      replace: 'BETA',
      byteOffset: 0,
      byteLength: 23,
    })
    expect(edited.failure).toBeUndefined()
    expect(edited.output).toContain('edited small.txt')
  })

  it('refuses a range edit the model never read', async () => {
    const { run } = contextFor()
    writeFileSync(small, 'alpha\nbeta\ngamma\ndelta\n')
    const edited = await run('edit_file', {
      path: 'small.txt',
      find: 'beta',
      replace: 'BETA',
      byteOffset: 0,
      byteLength: 23,
    })
    expect(edited.failure).toContain('read the byte window with read_file first')
  })

  it('refuses a find outside the read window', async () => {
    const { run } = contextFor()
    writeFileSync(small, 'alpha\nbeta\ngamma\ndelta\n')
    const read = await run('read_file', { path: 'small.txt', byteOffset: 0, byteLength: 6 })
    expect(read.failure).toBeUndefined()
    const edited = await run('edit_file', {
      path: 'small.txt',
      find: 'gamma',
      replace: 'GAMMA',
      byteOffset: 0,
      byteLength: 6,
    })
    expect(edited.output).toContain('find text not found in bytes 0–6')
    expect(edited.failure).toContain('not found in this window')
  })
})

describe('range addressed through the deferred chunk', () => {
  it('serves a window through the real modelApiTools entry', async () => {
    const entry = await import('../../src/core/backends/modelapi/modelApiToolsEntry')
    writeFileSync(small, 'alpha\nbeta\ngamma\ndelta\n')
    const { ctx } = contextFor()
    const outcome = await entry.readFileWindow(
      {
        relative: 'small.txt',
        canonical: 'small.txt',
        absolute: path.join(root, 'small.txt'),
        checkedAbsolute: path.join(root, 'small.txt'),
      },
      { byteOffset: 6, byteLength: 5 },
      ctx,
    )
    expect(outcome.output).toContain('(bytes 6–11 of 23)')
  })
})
