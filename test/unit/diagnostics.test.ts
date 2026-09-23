import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type DiagnosticEntry,
  diagnosticsTool,
  formatDiagnostics,
  type WorkspaceDiagnostic,
} from '../../src/core/diagnostics'
import { handleMcpMessage } from '../../src/core/mcp'
import { DIAGNOSTIC_MESSAGE_MAX_CHARS, DIAGNOSTICS_MAX_ENTRIES } from '../../src/shared/constants'

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
    const everything = await tool.call({})
    expect(everything.split('\n')).toEqual([
      'a.ts:1:1: error: root a',
      'packages/nested/x.ts:1:1: error: nested folder',
      'src/a.ts:1:1: error: in a',
      'src/b.ts:1:1: error: in b',
    ])
    expect(everything).not.toMatch(/second|outside|untitled/)
  })

  it('scopes to the one file a URI or path names, exactly, case-insensitively on Windows', async () => {
    expect(await tool.call({ uri: 'file:///c%3A/ws/src/a.ts' })).toBe('src/a.ts:1:1: error: in a')
    expect(await tool.call({ uri: 'file:///C:/ws/src/a.ts' })).toBe('src/a.ts:1:1: error: in a')
    expect(await tool.call({ uri: String.raw`C:\ws\src\b.ts` })).toBe('src/b.ts:1:1: error: in b')
    expect(await tool.call({ uri: 'SRC/B.TS' })).toBe('src/b.ts:1:1: error: in b')
    expect(await tool.call({ uri: './src/../a.ts' })).toBe('a.ts:1:1: error: root a')
    expect(await tool.call({ uri: 'src/none.ts' })).toBe('No diagnostics.')
  })

  it('never matches by suffix: a.ts is the root file, not src/a.ts', async () => {
    expect(await tool.call({ uri: 'a.ts' })).toBe('a.ts:1:1: error: root a')
    expect(await tool.call({ uri: 'x.ts' })).toBe('No diagnostics.')
  })

  it('answers a malformed URI or a file outside the workspace with an error', async () => {
    await expect(tool.call({ uri: 'file:///c:/ws/%E0%A4%A.ts' })).rejects.toThrow(
      'file:///c:/ws/%E0%A4%A.ts cannot be read as a file URI or path: URI malformed',
    )
    await expect(tool.call({ uri: String.raw`C:\second\src\a.ts` })).rejects.toThrow(
      String.raw`C:\second\src\a.ts does not name a file in the workspace`,
    )
    await expect(tool.call({ uri: '../second/src/a.ts' })).rejects.toThrow(
      'does not name a file in the workspace',
    )
    await expect(tool.call({ uri: 'file://server/share/a.ts' })).rejects.toThrow(
      'does not name a file in the workspace',
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
    expect(await tool.call({ uri: 'src/a.ts' })).toBe('src/a.ts:1:1: error: lower')
    expect(await tool.call({ uri: 'file:///home/me/ws/src/A.ts' })).toBe(
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
    expect(await tool.call({})).toBe('No diagnostics.')
    await expect(tool.call({ uri: 'src/a.ts' })).rejects.toThrow(
      'src/a.ts cannot be read as a file URI or path: src/a.ts is relative and no folder is open',
    )
  })
})
