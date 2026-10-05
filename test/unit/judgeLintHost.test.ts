import { describe, expect, it, vi } from 'vitest'
import { createHostLintExtractors } from '../../src/host/judge/lint'
import { extractLintFile } from '../../src/core/judge/lint/units'
import type { CodeSymbol } from '../../src/core/codeIntel/languageService'

const file = { path: 'src/unit.ts', language: 'typescript', source: '// 😀\r\nfunction f() {}\r\n' }
const mapping = { function: [12], type: [4], field: [7] }
const absolutePath = (path: string) => path
function symbol(kind = 12, children: readonly CodeSymbol[] = []): CodeSymbol {
  const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } }
  return {
    name: 'f',
    kind,
    detail: undefined,
    container: undefined,
    location: { path: file.path, range },
    selection: range,
    children,
  }
}

describe('host lint symbol adapter', () => {
  it('uses UTF-16 and CRLF offsets and delegates non-symbol kinds to the package', async () => {
    const syntax = vi.fn().mockResolvedValue({
      units: [{ kind: 'comment', name: '', start: 0, end: 5 }],
      coveredKinds: ['comment'],
    })
    const documentSymbols = vi.fn().mockResolvedValue([symbol()])
    const extractors = createHostLintExtractors({ documentSymbols }, mapping, syntax, absolutePath)
    const result = await extractLintFile(file, ['function', 'comment'], extractors)
    expect(documentSymbols).toHaveBeenCalledWith(file.path)
    expect(result.units.find((unit) => unit.kind === 'function')).toEqual({
      kind: 'function',
      name: 'f',
      start: 7,
      end: 22,
    })
    expect(file.source.slice(result.units[0]!.start, result.units[0]!.end)).toBe('function f() {}')
    expect(syntax).toHaveBeenCalledWith(file, ['comment'])
  })

  it('falls back when the outline is empty or lacks a requested declaration kind', async () => {
    const syntax = vi.fn().mockResolvedValue(undefined)
    const documentSymbols = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([symbol()])
    const extractors = createHostLintExtractors({ documentSymbols }, mapping, syntax, absolutePath)
    const empty = await extractLintFile(file, ['function'], extractors)
    expect(empty.coverage[0]?.reason).toBe('missing-extractor')
    const partial = await extractLintFile(file, ['function', 'field'], extractors)
    expect(syntax).toHaveBeenLastCalledWith(file, ['field'])
    expect(partial.coverage[1]?.reason).toBe('missing-extractor')
  })

  it('walks nested symbols while excluding external and virtual locations', async () => {
    const external = { ...symbol(7), location: { ...symbol().location, path: 'elsewhere.ts' } }
    const virtual = { ...symbol(7), location: { ...symbol().location, path: undefined } }
    const extractors = createHostLintExtractors(
      {
        documentSymbols: vi.fn().mockResolvedValue([symbol(4, [symbol(7)]), external, virtual]),
      },
      mapping,
      vi.fn().mockResolvedValue(undefined),
      absolutePath,
    )
    const result = await extractLintFile(file, ['type', 'field'], extractors)
    expect(result.units.map((unit) => unit.kind)).toEqual(['type', 'field'])
  })

  it.each([
    { line: -1, character: 0 },
    { line: 99, character: 0 },
    { line: 0, character: 6 },
    { line: 1, character: -1 },
    { line: 1.5, character: 0 },
    { line: 1, character: 0.5 },
  ])('rejects invalid symbol positions %#', async (start) => {
    const value = symbol()
    const invalid = {
      ...value,
      location: { ...value.location, range: { ...value.location.range, start } },
    }
    const extractors = createHostLintExtractors(
      { documentSymbols: vi.fn().mockResolvedValue([invalid]) },
      mapping,
      vi.fn(),
      absolutePath,
    )
    await expect(extractLintFile(file, ['function'], extractors)).rejects.toThrow(
      'lint-symbol-range-invalid',
    )
  })

  it('maps relative report paths to the absolute paths expected by language services', async () => {
    const path = 'C:/fixture-workspace/src/unit.ts'
    const value = symbol()
    const documentSymbols = vi
      .fn()
      .mockResolvedValue([{ ...value, location: { ...value.location, path } }])
    const extractors = createHostLintExtractors({ documentSymbols }, mapping, vi.fn(), () => path)
    const result = await extractLintFile(file, ['function'], extractors)
    expect(documentSymbols).toHaveBeenCalledWith(path)
    expect(result.units).toHaveLength(1)
    expect(result.coverage[0]?.path).toBe(file.path)
  })
})
