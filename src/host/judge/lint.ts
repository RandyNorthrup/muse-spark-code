import type {
  CodePosition,
  CodeSymbol,
  LanguageServiceHost,
} from '../../core/codeIntel/languageService'
import type { LintExtractors, LintFile, LintKind, LintUnit } from '../../core/judge/lint/units'

/** The host supplies VS Code's SymbolKind constants, rather than guessing numeric wire values. */
export interface LintSymbolKinds {
  readonly function: readonly number[]
  readonly type: readonly number[]
  readonly field: readonly number[]
}

function offset(source: string, position: CodePosition): number {
  if (
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.character) ||
    position.line < 0 ||
    position.character < 0
  ) {
    throw new RangeError('lint-symbol-range-invalid')
  }
  const lines = source.split('\n')
  const line = lines[position.line]
  if (line === undefined || position.character > line.replace(/\r$/, '').length) {
    throw new RangeError('lint-symbol-range-invalid')
  }
  let start = 0
  for (const before of lines.slice(0, position.line)) start += before.length + 1
  return start + position.character
}

function symbolUnits(
  file: LintFile,
  symbols: readonly CodeSymbol[],
  kinds: readonly LintKind[],
  mapping: LintSymbolKinds,
): LintUnit[] {
  const units: LintUnit[] = []
  for (const symbol of symbols) {
    if (symbol.location.path !== file.path) continue
    const kind = (['function', 'type', 'field'] as const).find(
      (candidate) => kinds.includes(candidate) && mapping[candidate].includes(symbol.kind),
    )
    if (kind !== undefined) {
      units.push({
        kind,
        name: symbol.name,
        start: offset(file.source, symbol.location.range.start),
        end: offset(file.source, symbol.location.range.end),
      })
    }
    units.push(...symbolUnits(file, symbol.children, kinds, mapping))
  }
  return units
}

/** The panel's syntax side delegates to the installed ACP package; absence returns undefined. */
export function createHostLintExtractors(
  services: Pick<LanguageServiceHost, 'documentSymbols'>,
  mapping: LintSymbolKinds,
  syntax: LintExtractors['syntax'],
  absolutePath: (path: string) => string,
): LintExtractors {
  return {
    async symbols(file, kinds) {
      const resolvedFile = { ...file, path: absolutePath(file.path) }
      const symbols = await services.documentSymbols(resolvedFile.path)
      if (symbols.length === 0) return
      const units = symbolUnits(resolvedFile, symbols, kinds, mapping)
      // A partial outline does not prove that a missing declaration kind was inspected.
      return { units, coveredKinds: [...new Set(units.map((unit) => unit.kind))] }
    },
    syntax,
  }
}
