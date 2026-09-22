import { describe, expect, it } from 'vitest'
import {
  type DiagnosticEntry,
  diagnosticsTool,
  formatDiagnostics,
  normaliseDiagnosticPath,
} from '../../src/core/diagnostics'
import { DIAGNOSTICS_MAX_ENTRIES } from '../../src/shared/constants'

const entries: readonly DiagnosticEntry[] = [
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
})

describe('normaliseDiagnosticPath', () => {
  it('strips file:// and a Windows drive slash, lower-cases and forward-slashes', () => {
    expect(normaliseDiagnosticPath('file:///c%3A/Users/x/A.ts')).toBe('c:/users/x/a.ts')
    expect(normaliseDiagnosticPath(String.raw`C:\Users\x\A.ts`)).toBe('c:/users/x/a.ts')
    expect(normaliseDiagnosticPath('/home/x/a.ts')).toBe('/home/x/a.ts')
  })
})

describe('diagnosticsTool', () => {
  const tool = diagnosticsTool({
    getDiagnostics: () => entries,
    workspaceRoot: String.raw`C:\ws`,
  })

  it('describes itself for tools/list', () => {
    expect(tool.name).toBe('getDiagnostics')
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { uri: { type: 'string' } },
    })
  })

  it('returns everything without a uri and scopes to a file with one', async () => {
    const everything = await tool.call({})
    expect(everything.split('\n')).toHaveLength(4)
    expect(await tool.call({ uri: 'file:///c%3A/ws/src/a.ts' })).toBe(
      'src/a.ts:2:1: error: worse\nsrc/a.ts:10:5: error: bad [ts]',
    )
    expect(await tool.call({ uri: 'src/b.ts' })).toContain('unused')
    expect(await tool.call({ uri: 'src/none.ts' })).toBe('No diagnostics.')
  })
})
