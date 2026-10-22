import * as z from 'zod/mini'

export const lintKinds = [
  'comment',
  'docComment',
  'field',
  'function',
  'statement',
  'type',
] as const
export type LintKind = (typeof lintKinds)[number]

/** The first grammar set in D77; another language must remain visible as unchecked. */
const languages: ReadonlySet<string> = new Set([
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
])
const symbolKinds: ReadonlySet<LintKind> = new Set(['function', 'type', 'field'])
const kindSchema = z.enum(lintKinds)
const offsetSchema = z.int().check(z.nonnegative())
export const unitSchema = z.strictObject({
  kind: kindSchema,
  name: z.string(),
  start: offsetSchema,
  end: offsetSchema,
  parentSource: z.optional(z.string()),
  regionKind: z.optional(z.string()),
  types: z.optional(z.array(z.strictObject({ name: z.string(), source: z.string() }))),
})
const extractionSchema = z.strictObject({
  units: z.array(unitSchema),
  coveredKinds: z.array(kindSchema),
})

/** Offsets count UTF-16 code units, just like VS Code's document text. */
export type LintUnit = z.infer<typeof unitSchema>
export interface LintFile {
  readonly path: string
  readonly language: string
  readonly source: string
}

/** Real symbol/grammar adapters return unknown at their package boundary. */
export interface LintExtractors {
  symbols(file: LintFile, kinds: readonly LintKind[]): Promise<unknown>
  syntax(file: LintFile, kinds: readonly LintKind[]): Promise<unknown>
}

export interface LintCoverage {
  readonly path: string
  readonly language: string
  readonly kind: LintKind | 'localize'
  readonly units: number
  readonly status: 'checked' | 'not-checked'
  readonly reason?:
    | 'unsupported-language'
    | 'missing-extractor'
    | 'no-units'
    | 'missing-localizer'
    | 'no-regions'
    | 'no-answer'
}

export interface LintExtraction {
  readonly units: readonly LintUnit[]
  readonly coverage: readonly LintCoverage[]
}

function readExtraction(raw: unknown, file: LintFile, requested: readonly LintKind[]) {
  if (raw === undefined) return
  const extraction = extractionSchema.parse(raw)
  if (
    extraction.coveredKinds.some((kind) => !requested.includes(kind)) ||
    extraction.units.some(
      (unit) =>
        !extraction.coveredKinds.includes(unit.kind) ||
        unit.end <= unit.start ||
        unit.end > file.source.length,
    )
  ) {
    throw new RangeError('lint-extraction-invalid')
  }
  return extraction
}

/** Symbols cannot cover comments, statements or localized regions (RVM98 finding 9). */
export async function extractLintFile(
  file: LintFile,
  kinds: readonly LintKind[],
  extractors: LintExtractors,
): Promise<LintExtraction> {
  const requested = [...new Set(kinds)]
  const units: LintUnit[] = []
  const covered = new Set<LintKind>()
  if (languages.has(file.language)) {
    const symbolRequested = requested.filter((kind) => symbolKinds.has(kind))
    const symbols =
      symbolRequested.length === 0
        ? undefined
        : readExtraction(await extractors.symbols(file, symbolRequested), file, symbolRequested)
    if (symbols !== undefined) {
      units.push(...symbols.units)
      for (const kind of symbols.coveredKinds) covered.add(kind)
    }
    const syntaxRequested = requested.filter((kind) => !covered.has(kind))
    if (syntaxRequested.length > 0) {
      const syntax = readExtraction(
        await extractors.syntax(file, syntaxRequested),
        file,
        syntaxRequested,
      )
      if (syntax !== undefined) {
        units.push(...syntax.units)
        for (const kind of syntax.coveredKinds) covered.add(kind)
      }
    }
  }
  return {
    units,
    coverage: requested.map((kind) => {
      const count = units.filter((unit) => unit.kind === kind).length
      let reason: LintCoverage['reason'] = 'unsupported-language'
      if (languages.has(file.language)) {
        reason = covered.has(kind) ? 'no-units' : 'missing-extractor'
      }
      return {
        path: file.path,
        language: file.language,
        kind,
        units: count,
        status: count > 0 ? 'checked' : 'not-checked',
        ...(count === 0 && { reason }),
      }
    }),
  }
}
