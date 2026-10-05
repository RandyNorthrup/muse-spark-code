import { describe, expect, it, vi } from 'vitest'
import { extractLintFile, type LintFile, type LintKind } from '../../src/core/judge/lint/units'

const file: LintFile = {
  path: 'src/sample.ts',
  language: 'typescript',
  source: '// note\nfunction read() { return 1 }',
}
const functionUnit = { kind: 'function', name: 'read', start: 8, end: file.source.length }

describe('lint extraction and coverage', () => {
  it('uses symbols for declarations and syntax for comments and statements', async () => {
    const symbols = vi.fn().mockResolvedValue({ units: [functionUnit], coveredKinds: ['function'] })
    const syntax = vi.fn().mockResolvedValue({
      units: [{ kind: 'comment', name: '', start: 0, end: 7 }],
      coveredKinds: ['comment', 'statement'],
    })
    const result = await extractLintFile(file, ['function', 'comment', 'statement'], {
      symbols,
      syntax,
    })
    expect(symbols).toHaveBeenCalledWith(file, ['function'])
    expect(syntax).toHaveBeenCalledWith(file, ['comment', 'statement'])
    expect(result.units).toHaveLength(2)
    expect(result.coverage).toEqual([
      { path: file.path, language: file.language, kind: 'function', units: 1, status: 'checked' },
      { path: file.path, language: file.language, kind: 'comment', units: 1, status: 'checked' },
      {
        path: file.path,
        language: file.language,
        kind: 'statement',
        units: 0,
        status: 'not-checked',
        reason: 'no-units',
      },
    ])
  })

  it('falls back to a grammar for files without a symbol provider', async () => {
    const syntax = vi.fn().mockResolvedValue({ units: [functionUnit], coveredKinds: ['function'] })
    const result = await extractLintFile(file, ['function'], {
      symbols: vi.fn().mockResolvedValue(undefined),
      syntax,
    })
    expect(syntax).toHaveBeenCalledWith(file, ['function'])
    expect(result.coverage[0]?.status).toBe('checked')
  })

  it('reports a missing grammar and an empty extraction as not checked', async () => {
    const result = await extractLintFile(file, ['comment', 'function'], {
      symbols: vi.fn().mockResolvedValue({ units: [], coveredKinds: ['function'] }),
      syntax: vi.fn().mockResolvedValue(undefined),
    })
    expect(result.coverage.map((row) => [row.kind, row.status, row.reason])).toEqual([
      ['comment', 'not-checked', 'missing-extractor'],
      ['function', 'not-checked', 'no-units'],
    ])
  })

  it.each(['c', 'cpp', 'csharp', 'kotlin', 'php', 'ruby', 'unknown'])(
    'reports unsupported %s without invoking an extractor',
    async (language) => {
      const symbols = vi.fn()
      const syntax = vi.fn()
      const result = await extractLintFile({ ...file, language }, ['comment', 'function'], {
        symbols,
        syntax,
      })
      expect(result.coverage).toHaveLength(2)
      expect(result.coverage.every((row) => row.reason === 'unsupported-language')).toBe(true)
      expect(symbols).not.toHaveBeenCalled()
      expect(syntax).not.toHaveBeenCalled()
    },
  )

  it.each(['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java'])(
    'permits an injected grammar for %s',
    async (language) => {
      const result = await extractLintFile({ ...file, language }, ['function'], {
        symbols: vi.fn().mockResolvedValue(undefined),
        syntax: vi.fn().mockResolvedValue({ units: [functionUnit], coveredKinds: ['function'] }),
      })
      expect(result.units).toHaveLength(1)
    },
  )

  it.each([
    { units: [{ ...functionUnit, start: -1 }], coveredKinds: ['function'] },
    { units: [{ ...functionUnit, end: 999 }], coveredKinds: ['function'] },
    { units: [{ ...functionUnit, end: functionUnit.start }], coveredKinds: ['function'] },
    { units: [functionUnit], coveredKinds: [] },
    { units: [functionUnit], coveredKinds: ['comment'] },
    { units: [], coveredKinds: ['comment'] },
    { units: [], coveredKinds: ['function'], source: 'unvalidated-extra' },
  ])('rejects invalid adapter data %#', async (raw) => {
    await expect(
      extractLintFile(file, ['function'], {
        symbols: vi.fn().mockResolvedValue(raw),
        syntax: vi.fn(),
      }),
    ).rejects.toThrow()
  })

  it('does not request the same kind twice', async () => {
    const kinds: LintKind[] = ['function', 'function']
    const result = await extractLintFile(file, kinds, {
      symbols: vi.fn().mockResolvedValue({ units: [functionUnit], coveredKinds: ['function'] }),
      syntax: vi.fn(),
    })
    expect(result.coverage).toHaveLength(1)
  })
})
