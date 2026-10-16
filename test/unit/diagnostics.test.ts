import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type DiagnosticEntry,
  diagnosticsTool,
  formatDiagnostics,
  type WorkspaceDiagnostic,
} from '../../src/core/diagnostics'
import { handleMcpMessage } from '../../src/core/mcp'
import {
  DIAGNOSTIC_MESSAGE_MAX_CHARS,
  DIAGNOSTICS_MAX_ENTRIES,
  MODEL_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

// A caller that never stops waiting (M69 gave tools a signal).
const NOT_STOPPED = new AbortController().signal

const entries: readonly WorkspaceDiagnostic[] = [
  {
    path: 'src/b.ts',
    severity: 'warning',
    line: 3,
    column: 1,
    message: 'unused',
    source: 'eslint',
  },
  { path: 'src/a.ts', severity: 'error', line: 10, column: 5, message: 'bad', source: 'ts' },
  { path: 'src/a.ts', severity: 'error', line: 2, column: 1, message: 'worse', source: undefined },
  { path: 'src/b.ts', severity: 'hint', line: 1, column: 1, message: 'meh', source: 'ts' },
]

describe('formatDiagnostics', () => {
  it('pages one long diagnostic message without discarding its tail', () => {
    const diagnostic = { ...entries[0]!, message: 'x'.repeat(1000) + 'important tail' }
    const first = formatDiagnostics(
      [diagnostic],
      1,
      0,
      undefined,
      0,
      (entryOffset, messageOffset) =>
        `offset ${String(entryOffset)} messageOffset ${String(messageOffset)}`,
    )
    expect(first).toContain('offset 0 messageOffset 1000')
    expect(formatDiagnostics([diagnostic], 1, 0, undefined, 1000)).toContain('important tail')
  })
  it('lists errors first, then by path and line, one line each', () => {
    expect(formatDiagnostics(entries)).toBe(
      [
        'src/a.ts:2:1: error: worse',
        'src/a.ts:10:5: error: bad [ts]',
        'src/b.ts:3:1: warning: unused [eslint]',
        'src/b.ts:1:1: hint: meh [ts]',
      ].join('\n'),
    )
  })

  it('says so when there are none and caps a flood with a count', () => {
    expect(formatDiagnostics([])).toBe('No diagnostics.')
    const flood = Array.from({ length: DIAGNOSTICS_MAX_ENTRIES + 7 }, (_, index) => ({
      ...entries[1]!,
      line: index + 1,
    }))
    const text = formatDiagnostics(flood)
    expect(text.split('\n')).toHaveLength(DIAGNOSTICS_MAX_ENTRIES + 1)
    expect(text.endsWith('… 7 more not shown')).toBe(true)
  })

  it('pages entries by offset and names the offset that fetches the rest (B6)', () => {
    const flood = Array.from({ length: DIAGNOSTICS_MAX_ENTRIES + 7 }, (_, index) => ({
      ...entries[1]!,
      line: index + 1,
    }))
    const next = `call getDiagnostics again with offset ${String(DIAGNOSTICS_MAX_ENTRIES)} for the rest`
    const first = formatDiagnostics(flood, DIAGNOSTICS_MAX_ENTRIES, 0, next)
    expect(first.split('\n')).toHaveLength(DIAGNOSTICS_MAX_ENTRIES + 1)
    expect(
      first.endsWith(
        `[diagnostics 1-${String(DIAGNOSTICS_MAX_ENTRIES)} of ${String(DIAGNOSTICS_MAX_ENTRIES + 7)}; ${next}]`,
      ),
    ).toBe(true)
    const second = formatDiagnostics(
      flood,
      DIAGNOSTICS_MAX_ENTRIES,
      DIAGNOSTICS_MAX_ENTRIES,
      'call getDiagnostics again with offset 207 for the rest',
    )
    expect(second.split('\n')).toHaveLength(7)
    expect(second).not.toContain('more not shown')
  })

  it('refuses a past-end offset with the valid range (B6)', () => {
    const few = [entries[1]!, entries[2]!, entries[0]!]
    expect(() => formatDiagnostics(few, DIAGNOSTICS_MAX_ENTRIES, 3)).toThrow(RangeError)
    expect(() => formatDiagnostics(few, DIAGNOSTICS_MAX_ENTRIES, 3)).toThrow(
      'offset 3 is past the last of 3 diagnostics; use an offset from 0 to 2',
    )
  })

  it('clips a long message with a count, never inside a surrogate pair (D27)', () => {
    const long = { ...entries[1]!, message: 'x'.repeat(DIAGNOSTIC_MESSAGE_MAX_CHARS + 500) }
    expect(formatDiagnostics([long])).toBe(
      `src/a.ts:10:5: error: ${'x'.repeat(DIAGNOSTIC_MESSAGE_MAX_CHARS)}… [500 characters clipped] [ts]`,
    )
    const emoji = {
      ...entries[1]!,
      message: `${'x'.repeat(DIAGNOSTIC_MESSAGE_MAX_CHARS - 1)}😀${'y'.repeat(10)}`,
    }
    expect(formatDiagnostics([emoji])).toBe(
      `src/a.ts:10:5: error: ${'x'.repeat(DIAGNOSTIC_MESSAGE_MAX_CHARS - 1)}… [12 characters clipped] [ts]`,
    )
    const exact = { ...entries[1]!, message: 'z'.repeat(DIAGNOSTIC_MESSAGE_MAX_CHARS) }
    expect(formatDiagnostics([exact])).not.toContain('clipped')
  })
})

/**
 * An entry as the host hands it over: by its root-relative path, undefined
 * for a resource outside the root (a second folder, the user's other
 * files, an untitled document).
 */
function at(relativePath: string | undefined, message: string): DiagnosticEntry {
  return { path: relativePath, severity: 'error', line: 1, column: 1, message, source: undefined }
}

/** The host's `relativeInRoot` for a single-folder window rooted at `root`. */
function relativeIn(root: string, platform: NodeJS.Platform) {
  const p = platform === 'win32' ? path.win32 : path.posix
  return (absolutePath: string) => {
    const relative = p.relative(root, absolutePath)
    return relative === '' || relative.startsWith('..') || p.isAbsolute(relative)
      ? undefined
      : relative.split(p.sep).join('/')
  }
}

describe('diagnosticsTool (Windows root)', () => {
  const reported: readonly DiagnosticEntry[] = [
    at('src/a.ts', 'in a'),
    at('src/b.ts', 'in b'),
    at('a.ts', 'root a'),
    at('packages/nested/x.ts', 'nested folder'),
    at(undefined, 'second folder'),
    at(undefined, 'outside'),
    at(undefined, 'untitled'),
  ]
  const tool = diagnosticsTool({
    getDiagnostics: () => reported,
    workspaceRoot: String.raw`C:\ws`,
    platform: 'win32',
    relativeInRoot: relativeIn(String.raw`C:\ws`, 'win32'),
  })

  it('describes itself for tools/list', () => {
    expect(tool.name).toBe('getDiagnostics')
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { uri: { type: 'string' } },
    })
  })

  it('reports only the files under the root, by relative path (D27)', async () => {
    const everything = await tool.call({}, NOT_STOPPED)
    expect(everything.split('\n')).toEqual([
      'a.ts:1:1: error: root a',
      'packages/nested/x.ts:1:1: error: nested folder',
      'src/a.ts:1:1: error: in a',
      'src/b.ts:1:1: error: in b',
    ])
    expect(everything).not.toMatch(/second|outside|untitled/)
  })

  it('scopes to the one file a URI or path names, exactly, case-insensitively on Windows', async () => {
    expect(await tool.call({ uri: 'file:///c%3A/ws/src/a.ts' }, NOT_STOPPED)).toBe(
      'src/a.ts:1:1: error: in a',
    )
    expect(await tool.call({ uri: 'file:///C:/ws/src/a.ts' }, NOT_STOPPED)).toBe(
      'src/a.ts:1:1: error: in a',
    )
    expect(await tool.call({ uri: String.raw`C:\ws\src\b.ts` }, NOT_STOPPED)).toBe(
      'src/b.ts:1:1: error: in b',
    )
    expect(await tool.call({ uri: 'SRC/B.TS' }, NOT_STOPPED)).toBe('src/b.ts:1:1: error: in b')
    expect(await tool.call({ uri: './src/../a.ts' }, NOT_STOPPED)).toBe('a.ts:1:1: error: root a')
    expect(await tool.call({ uri: 'src/none.ts' }, NOT_STOPPED)).toBe('No diagnostics.')
  })

  it('never matches by suffix: a.ts is the root file, not src/a.ts', async () => {
    expect(await tool.call({ uri: 'a.ts' }, NOT_STOPPED)).toBe('a.ts:1:1: error: root a')
    expect(await tool.call({ uri: 'x.ts' }, NOT_STOPPED)).toBe('No diagnostics.')
  })

  it('answers a malformed URI or a file outside the workspace with an error', async () => {
    await expect(tool.call({ uri: 'file:///c:/ws/%E0%A4%A.ts' }, NOT_STOPPED)).rejects.toThrow(
      'file:///c:/ws/%E0%A4%A.ts cannot be read as a file URI or path: URI malformed',
    )
    await expect(tool.call({ uri: String.raw`C:\second\src\a.ts` }, NOT_STOPPED)).rejects.toThrow(
      String.raw`C:\second\src\a.ts does not name a file in the workspace`,
    )
    await expect(tool.call({ uri: '../second/src/a.ts' }, NOT_STOPPED)).rejects.toThrow(
      'does not name a file in the workspace',
    )
    await expect(tool.call({ uri: 'file://server/share/a.ts' }, NOT_STOPPED)).rejects.toThrow(
      'does not name a file in the workspace',
    )
  })

  it('pages the whole workspace by offset, naming the next one (B6)', async () => {
    const flood = Array.from({ length: DIAGNOSTICS_MAX_ENTRIES + 3 }, (_, index) =>
      at('src/a.ts', `problem ${String(index + 1)}`),
    )
    const paging = diagnosticsTool({
      getDiagnostics: () => flood,
      workspaceRoot: String.raw`C:\ws`,
      platform: 'win32',
      relativeInRoot: relativeIn(String.raw`C:\ws`, 'win32'),
    })
    const first = await paging.call({}, NOT_STOPPED)
    expect(first.split('\n')).toHaveLength(DIAGNOSTICS_MAX_ENTRIES + 1)
    expect(first).toContain(
      `[diagnostics 1-${String(DIAGNOSTICS_MAX_ENTRIES)} of ${String(DIAGNOSTICS_MAX_ENTRIES + 3)}; call getDiagnostics again with offset ${String(DIAGNOSTICS_MAX_ENTRIES)} for the rest]`,
    )
    const second = await paging.call({ offset: DIAGNOSTICS_MAX_ENTRIES }, NOT_STOPPED)
    expect(second.split('\n')).toHaveLength(3)
    await expect(paging.call({ offset: DIAGNOSTICS_MAX_ENTRIES + 3 }, NOT_STOPPED)).rejects.toThrow(
      `offset ${String(DIAGNOSTICS_MAX_ENTRIES + 3)} is past the last of`,
    )
  })

  it('reaches the model as an MCP error result, not a crash', async () => {
    const outcome = await handleMcpMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'getDiagnostics', arguments: { uri: 'file:///c:/%E0%A4%A' } },
      }),
      [tool],
      { name: 'test', version: '1' },
    )
    expect(outcome).toMatchObject({
      kind: 'response',
      body: { result: { isError: true, content: [{ type: 'text' }] } },
    })
  })
})

describe('diagnosticsTool (POSIX root and no root)', () => {
  const reported = [at('src/A.ts', 'upper'), at('src/a.ts', 'lower')]

  it('compares paths case-sensitively where the file system does', async () => {
    const tool = diagnosticsTool({
      getDiagnostics: () => reported,
      workspaceRoot: '/home/me/ws',
      platform: 'linux',
      relativeInRoot: relativeIn('/home/me/ws', 'linux'),
    })
    expect(await tool.call({ uri: 'src/a.ts' }, NOT_STOPPED)).toBe('src/a.ts:1:1: error: lower')
    expect(await tool.call({ uri: 'file:///home/me/ws/src/A.ts' }, NOT_STOPPED)).toBe(
      'src/A.ts:1:1: error: upper',
    )
  })

  it('reports nothing without a folder and refuses a relative request', async () => {
    const tool = diagnosticsTool({
      getDiagnostics: () => [at(undefined, 'no folder, nothing is in the root')],
      workspaceRoot: undefined,
      platform: 'linux',
      relativeInRoot: () => undefined,
    })
    expect(await tool.call({}, NOT_STOPPED)).toBe('No diagnostics.')
    await expect(tool.call({ uri: 'src/a.ts' }, NOT_STOPPED)).rejects.toThrow(
      'src/a.ts cannot be read as a file URI or path: src/a.ts is relative and no folder is open',
    )
  })

  // M68: the servers report only on a file an editor shows, so a request for
  // one file shows it and waits before reading; the whole workspace does not.
  it('settles a named file and reads it while it shows, and only a named one', async () => {
    const settled: { readonly path: string; readonly signal: AbortSignal | undefined }[] = []
    const tool = diagnosticsTool({
      // A server clears a file's diagnostics when its tab closes (the
      // integration run), so what VS Code holds after is not what counts.
      getDiagnostics: () => [],
      workspaceRoot: '/home/me/ws',
      platform: 'linux',
      relativeInRoot: relativeIn('/home/me/ws', 'linux'),
      settleFile: (absolutePath, signal) => {
        settled.push({ path: absolutePath, signal })
        return Promise.resolve([at('src/a.ts', 'reported once shown')])
      },
    })
    expect(await tool.call({}, new AbortController().signal)).toBe('No diagnostics.')
    expect(settled).toEqual([])
    const stop = new AbortController()
    expect(await tool.call({ uri: 'src/a.ts' }, stop.signal)).toBe(
      'src/a.ts:1:1: error: reported once shown',
    )
    // The caller's stop reaches the wait (M68, the review).
    expect(settled).toEqual([
      { path: path.posix.join('/home/me/ws', 'src/a.ts'), signal: stop.signal },
    ])
    await expect(tool.call({ uri: '../outside.ts' }, stop.signal)).rejects.toThrow(
      'does not name a file',
    )
    expect(settled).toHaveLength(1)
  })

  it('says a file its server never reported on is not checked, never clean', async () => {
    let held: readonly DiagnosticEntry[] = []
    const tool = diagnosticsTool({
      getDiagnostics: () => held,
      workspaceRoot: '/home/me/ws',
      platform: 'linux',
      relativeInRoot: relativeIn('/home/me/ws', 'linux'),
      settleFile: () => Promise.resolve(undefined),
    })
    const signal = new AbortController().signal
    expect(await tool.call({ uri: 'src/a.ts' }, signal)).toBe(
      fill(MODEL_TEXT.diagnosticsNotSettled, { path: 'src/a.ts' }),
    )
    // A file an editor already showed keeps what VS Code holds for it.
    held = [at('src/a.ts', 'held from before')]
    expect(await tool.call({ uri: 'src/a.ts' }, signal)).toBe(
      'src/a.ts:1:1: error: held from before',
    )
  })
})
