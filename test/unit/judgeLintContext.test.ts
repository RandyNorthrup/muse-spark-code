import { describe, expect, it } from 'vitest'
import { resolveLintCallees, type LintFunction } from '../../src/core/judge/lint/context'

const limits = { maxCallees: 12, maxCalleeBytes: 16_384 }
function target(
  name: string,
  path = 'src/main.ts',
  source = `function ${name}() {}`,
): LintFunction {
  return {
    file: { path, language: 'typescript', source },
    unit: { kind: 'function', name, start: 0, end: source.length },
    calls: [],
  }
}
const caller = (calls: unknown): LintFunction => ({ ...target('caller'), calls })

describe('pinned upstream direct callee semantics', () => {
  it('prefers one same-file declaration then one unambiguous project declaration', () => {
    const near = target('helper')
    const far = target('helper', 'src/other.ts')
    const external = target('other', 'src/other.ts')
    expect(
      resolveLintCallees(
        caller([
          { name: 'helper', path: '' },
          { name: 'other', path: '' },
        ]),
        [near, far, external],
        limits,
      ),
    ).toEqual([
      { name: 'helper', path: near.file.path, source: near.file.source },
      { name: 'other', path: external.file.path, source: external.file.source },
    ])
  })

  it('refuses qualified, recursive, missing, non-function and ambiguous callees', () => {
    const calls = [
      { name: 'helper', path: 'external' },
      { name: 'caller', path: '' },
      { name: 'missing', path: '' },
      { name: 'type', path: '' },
      { name: '', path: '' },
    ]
    expect(
      resolveLintCallees(
        caller(calls),
        [
          target('helper'),
          target('caller'),
          { ...target('type'), unit: { ...target('type').unit, kind: 'type' } },
        ],
        limits,
      ),
    ).toEqual([])
    expect(
      resolveLintCallees(
        caller([{ name: 'helper', path: '' }]),
        [target('helper'), target('helper')],
        limits,
      ),
    ).toEqual([])
    expect(
      resolveLintCallees(
        caller([{ name: 'helper', path: '' }]),
        [target('helper', 'src/a.ts'), target('helper', 'src/b.ts')],
        limits,
      ),
    ).toEqual([])
  })

  it('deduplicates and stops at depth one without following callee calls', () => {
    const helper = { ...target('helper'), calls: [{ name: 'deep', path: '' }] }
    expect(
      resolveLintCallees(
        caller([
          { name: 'helper', path: '' },
          { name: 'helper', path: '' },
        ]),
        [helper, target('deep')],
        limits,
      ),
    ).toEqual([{ name: 'helper', path: helper.file.path, source: helper.file.source }])
  })

  it('bounds count and UTF-8 source bytes, skipping a too-large callee', () => {
    const functions = Array.from({ length: 13 }, (_, index) => target(`f${String(index)}`))
    const calls = functions.map((item) => ({ name: item.unit.name, path: '' }))
    expect(resolveLintCallees(caller(calls), functions, limits)).toHaveLength(12)
    const large = target('large', 'src/main.ts', '😀'.repeat(4097))
    const small = target('small', 'src/main.ts', 'small')
    const exact = target('exact', 'src/main.ts', '😀'.repeat(4096))
    expect(
      resolveLintCallees(
        caller([
          { name: 'large', path: '' },
          { name: 'small', path: '' },
        ]),
        [large, small],
        limits,
      ),
    ).toEqual([{ name: 'small', path: small.file.path, source: 'small' }])
    expect(resolveLintCallees(caller([{ name: 'exact', path: '' }]), [exact], limits)).toHaveLength(
      1,
    )
    expect(
      resolveLintCallees(caller([{ name: 'small', path: '' }]), [small], {
        maxCallees: 0,
        maxCalleeBytes: 0,
      }),
    ).toEqual([])
  })

  it('validates grammar call records and declaration ranges', () => {
    expect(() =>
      resolveLintCallees(caller([{ name: 'helper', path: '', extra: true }]), [], limits),
    ).toThrow()
    for (const [start, end] of [
      [-1, 1],
      [0, 0],
      [0, 999],
    ] as const) {
      expect(() =>
        resolveLintCallees(
          caller([{ name: 'helper', path: '' }]),
          [{ ...target('helper'), unit: { ...target('helper').unit, start, end } }],
          limits,
        ),
      ).toThrow('lint-extraction-invalid')
    }
  })
})
