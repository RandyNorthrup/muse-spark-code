import { readFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { readLintSyntax } from '../../src/core/judge/lint/syntax'
import { resolveLintCallees } from '../../src/core/judge/lint/context'
import { extractLintFile, lintKinds, type LintUnit } from '../../src/core/judge/lint/units'

const typeSchema = z.looseObject({ name: z.string(), source: z.string() })
const spanSchema = {
  startByte: z.int(),
  endByte: z.int(),
}
const captureSchema = z.array(
  z.strictObject({
    path: z.string(),
    language: z.string(),
    source: z.string(),
    raw: z.unknown(),
    expected: z.array(
      z.strictObject({
        unit: z.looseObject({
          kind: z.enum(lintKinds),
          name: z.string(),
          ...spanSchema,
          source: z.string(),
          types: z.optional(z.array(typeSchema)),
        }),
        calls: z.nullable(z.array(z.strictObject({ Name: z.string(), Path: z.string() }))),
        callees: z.nullable(
          z.array(z.looseObject({ name: z.string(), path: z.string(), source: z.string() })),
        ),
        regions: z.nullable(
          z.array(z.looseObject({ category: z.enum(lintKinds), kind: z.string(), ...spanSchema })),
        ),
      }),
    ),
  }),
)
const captures = captureSchema.parse(
  JSON.parse(
    await readFile(
      new URL('../fixtures/judge/lint/upstream/syntax-capture.json', import.meta.url),
      'utf8',
    ),
  ),
)
const languages = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java']
const limits = { maxCallees: 12, maxCalleeBytes: 16_384 }

describe('real pinned seven-grammar syntax extraction', () => {
  it.each(languages)(
    'matches %s declarations, regions, documentation, types and callees',
    async (language) => {
      const examples = captures.filter((capture) => capture.language === language)
      expect(examples).toHaveLength(language === 'javascript' || language === 'python' ? 5 : 4)
      for (const file of examples) {
        const parsed = readLintSyntax(file, file.raw, 24)
        const offset = (byte: number) =>
          Buffer.from(file.source).subarray(0, byte).toString('utf8').length
        const expectedUnit = (raw: (typeof file.expected)[number]['unit']): LintUnit => ({
          kind: raw.kind,
          name: raw.name,
          start: offset(raw.startByte),
          end: offset(raw.endByte),
          ...(raw.types !== undefined && {
            types: raw.types.map(({ name, source }) => ({ name, source })),
          }),
        })
        expect(
          parsed.units.filter((unit) => unit.kind === 'function' || unit.kind === 'type'),
        ).toEqual(file.expected.map(({ unit }) => expectedUnit(unit)))
        const extraction = await extractLintFile(file, lintKinds, {
          symbols: () => Promise.resolve(undefined),
          syntax: (_file, kinds) =>
            Promise.resolve({
              units: parsed.units.filter((unit) => kinds.includes(unit.kind)),
              coveredKinds: kinds,
            }),
        })
        expect(extraction.units).toEqual(parsed.units)
        if (file.path.endsWith('/nested.js')) {
          expect(
            parsed.units.find((unit) => unit.name === 'nested:return_statement'),
          ).toMatchObject({ parentSource: 'function nested() { return hidden() }' })
        }
        for (const expected of file.expected) {
          const unit = expectedUnit(expected.unit)
          expect(parsed.localize(unit)).toEqual(
            (expected.regions ?? []).map((region) => ({
              kind: region.category,
              regionKind: region.kind,
              name: `${unit.name}:${region.kind}`,
              start: offset(region.startByte),
              end: offset(region.endByte),
              parentSource: expected.unit.source,
              ...(unit.types !== undefined && { types: unit.types }),
            })),
          )
          if (unit.kind !== 'function') continue
          const caller = parsed.functions.find(
            (item) =>
              item.unit.start === unit.start &&
              item.unit.end === unit.end &&
              item.unit.name === unit.name,
          )
          expect(caller).toBeDefined()
          if (caller === undefined) throw new Error('missing captured function')
          expect(caller.calls).toEqual(
            (expected.calls ?? []).map(({ Name, Path }) => ({ name: Name, path: Path })),
          )
          expect(resolveLintCallees(caller, parsed.functions, limits)).toEqual(
            (expected.callees ?? []).map(({ name, path, source }) => ({
              name,
              path: path.replaceAll('\\', '/'),
              source,
            })),
          )
        }
      }
    },
  )

  it('rejects parse errors, invalid references and invalid byte boundaries', () => {
    const file = captures[0]!
    const raw = z.record(z.string(), z.unknown()).parse(file.raw)
    expect(() => readLintSyntax(file, { ...raw, hasError: true }, 24)).toThrow(
      'lint-extraction-invalid',
    )
    const nodes = z.array(z.record(z.string(), z.unknown())).parse(raw['nodes'])
    const emptyQueries = { function: [], type: [], context: [], call: [] }
    expect(() =>
      readLintSyntax(
        file,
        {
          ...raw,
          queries: emptyQueries,
          nodes: [{ ...nodes[0], startByte: 1, endByte: 0 }],
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    expect(() =>
      readLintSyntax(
        file,
        {
          ...raw,
          queries: emptyQueries,
          nodes: [
            {
              ...nodes[0],
              previous: 0,
              startByte: file.source.length,
              endByte: file.source.length,
            },
          ],
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    expect(() =>
      readLintSyntax(file, { ...raw, nodes: [{ ...nodes[0], parent: 0 }, ...nodes.slice(1)] }, 24),
    ).toThrow('lint-extraction-invalid')
    expect(() =>
      readLintSyntax(
        file,
        { ...raw, nodes: [{ ...nodes[0], endByte: file.source.length + 1 }, ...nodes.slice(1)] },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    expect(() => readLintSyntax(file, file.raw, 0)).toThrow('lint-extraction-invalid')
    expect(() => readLintSyntax(file, file.raw, 1.5)).toThrow('lint-extraction-invalid')
    expect(() => readLintSyntax(file, { ...raw, unexpected: true }, 24)).toThrow()
    expect(() =>
      readLintSyntax(
        file,
        {
          ...raw,
          nodes: [...nodes.slice(0, -1), { ...nodes.at(-1), parent: 1, previous: -1 }],
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    expect(() =>
      readLintSyntax(
        file,
        {
          ...raw,
          nodes: [nodes[0], { ...nodes[1], previous: 0 }, ...nodes.slice(2)],
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    const unicode = captures.find((capture) => capture.source.includes('😀'))!
    const unicodeRaw = z.record(z.string(), z.unknown()).parse(unicode.raw)
    const unicodeNodes = z.array(z.record(z.string(), z.unknown())).parse(unicodeRaw['nodes'])
    expect(() =>
      readLintSyntax(
        unicode,
        {
          ...unicodeRaw,
          nodes: [{ ...unicodeNodes[0], startByte: 4 }, ...unicodeNodes.slice(1)],
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
    expect(() =>
      readLintSyntax(
        file,
        {
          ...raw,
          queries: {
            function: [{ function: nodes.length, name: 0 }],
            type: [],
            context: [],
            call: [],
          },
        },
        24,
      ),
    ).toThrow('lint-extraction-invalid')
  })

  it('keeps missing syntax kinds visibly unchecked and bounds localized regions', async () => {
    const file = captures[0]!
    const parsed = readLintSyntax(file, file.raw, 1)
    const complete = readLintSyntax(file, file.raw, 24)
    const unit = complete.units.find(
      (unit) => unit.kind === 'function' && complete.localize(unit).length > 1,
    )!
    expect(complete.localize(unit).length).toBeGreaterThan(1)
    expect(parsed.localize(unit)).toHaveLength(1)
    const extraction = await extractLintFile(file, ['comment'], {
      symbols: () => Promise.resolve(undefined),
      syntax: () => Promise.resolve(undefined),
    })
    expect(extraction.coverage).toMatchObject([
      { status: 'not-checked', reason: 'missing-extractor' },
    ])
  })
})
