import { describe, expect, it } from 'vitest'
import {
  decodeLintConfig,
  decodeLintPackRules,
  normalizeLintRules,
  type UpstreamLintRule,
} from '../../src/core/judge/lint/config'
import {
  decodeLintEvals,
  decodeLintPackManifest,
  mergeLintPacks,
} from '../../src/core/judge/lint/formats'

const rule: UpstreamLintRule = {
  id: 'one',
  description: 'Perform the operation honestly.',
  severity: 'error',
}
const config = { languages: { typescript: {} }, rules: [rule] }
const pin = { id: 'owner/pack', source: 'https://example.invalid/pack', sha: 'pinned-sha' }
const manifest = decodeLintPackManifest(
  JSON.stringify({ version: 1, id: pin.id, languages: ['typescript'] }),
)
const read = (value: unknown) => decodeLintConfig(JSON.stringify(value))

describe('pinned upstream JSON contracts', () => {
  it('normalizes upstream defaults, confidence inheritance and selected regions', () => {
    const cfg = read({
      ...config,
      minConfidence: 0.7,
      rules: [
        {
          ...rule,
          kinds: [],
          localize: ['comment', 'statement'],
          allowSkip: true,
          allowAbstain: true,
          context: { callees: true },
          exceptions: ['Explicit exception'],
        },
        { ...rule, id: 'two', kinds: ['field'], minConfidence: 0 },
      ],
    })
    expect(normalizeLintRules(cfg)).toMatchObject([
      {
        kinds: ['function', 'type'],
        minConfidence: 0.7,
        localize: ['comment', 'statement'],
        allowSkip: true,
        allowAbstain: true,
        callees: true,
        exceptions: ['Explicit exception'],
      },
      { kinds: ['field'], minConfidence: 0, allowSkip: false, allowAbstain: false, callees: false },
    ])
    expect(normalizeLintRules(read(config))[0]?.minConfidence).toBe(0)
    expect(
      normalizeLintRules(
        read({
          ...config,
          languages: { typescript: null },
          rules: [{ ...rule, include: null, kinds: null, context: null, allowSkip: null }],
        }),
      )[0],
    ).toMatchObject({ include: [], kinds: ['function', 'type'], allowSkip: false })
  })

  it.each([
    { ...config, museSpark: {} },
    { ...config, engine: 'same' },
    { languages: { typescript: { extra: true } }, rules: [rule] },
    { languages: { typescript: { regions: { extra: ['comment'] } } }, rules: [rule] },
    { ...config, rules: [{ ...rule, extra: true }] },
    { ...config, rules: [{ ...rule, context: { extra: true } }] },
    { ...config, packs: [{ ...pin, extra: true }] },
  ])('rejects unknown fields at every boundary %#', (value) => {
    expect(() => read(value)).toThrow()
  })

  it.each([
    { ...config, languages: {} },
    { ...config, languages: { unknown: {} } },
    { ...config, languages: { typescript: { extensions: [] } } },
    { ...config, languages: { typescript: { extensions: ['TS'] } } },
    { ...config, languages: { typescript: { extensions: ['.TS'] } } },
    { ...config, languages: { typescript: { extensions: ['../ts'] } } },
    { ...config, languages: { typescript: { extensions: ['.ts', '.ts'] } } },
    { ...config, languages: { typescript: { extensions: ['.ts'] }, tsx: { extensions: ['.ts'] } } },
    { ...config, languages: { typescript: { functionQueries: [] } } },
    { ...config, languages: { typescript: { typeQueries: [' '] } } },
    { ...config, languages: { typescript: { typeContextQueries: [] } } },
    { ...config, languages: { typescript: { regions: { comment: [] } } } },
    { ...config, languages: { typescript: { regions: { statement: [' '] } } } },
    { ...config, minConfidence: -1 },
    { ...config, minConfidence: 2 },
    { ...config, rules: [{ ...rule, id: ' ' }] },
    { ...config, rules: [rule, rule] },
    { ...config, rules: [{ ...rule, description: ' ' }] },
    { ...config, rules: [{ id: 'one', description: rule.description }] },
    { ...config, rules: [{ ...rule, severity: 'fatal' }] },
    { ...config, rules: [{ ...rule, severity: null }] },
    { ...config, rules: [{ ...rule, kinds: ['file'] }] },
    { ...config, rules: [{ ...rule, localize: ['function'] }] },
    { ...config, rules: [{ ...rule, localize: true }] },
    { ...config, rules: [{ ...rule, include: [' '] }] },
    { ...config, rules: [{ ...rule, exclude: [''] }] },
    { ...config, packs: [{ ...pin, sha: '' }] },
    { ...config, packs: [pin, pin] },
  ])('rejects upstream semantic errors %#', (value) => {
    expect(() => read(value)).toThrow()
  })

  it('preserves valid overrides and recognized but unsupported presets', () => {
    expect(
      read({
        ...config,
        languages: {
          c: {},
          typescript: {
            extensions: ['.custom'],
            functionQueries: ['(function_declaration) @function'],
            typeQueries: ['(class_declaration) @type'],
            regions: { comment: ['comment'] },
          },
        },
      }).languages,
    ).toHaveProperty('c')
  })

  it('rejects trailing JSON values in config, manifest, rules and evals', () => {
    expect(() => decodeLintConfig(`${JSON.stringify(config)} {}`)).toThrow()
    expect(() => decodeLintPackManifest(`${JSON.stringify(manifest)} {}`)).toThrow()
    expect(() => decodeLintPackRules(`${JSON.stringify({ rules: [rule] })} {}`)).toThrow()
    expect(() => decodeLintEvals('{"version":1,"cases":[]} {}', read(config))).toThrow()
  })

  it.each([
    '../rules.json',
    '/rules.json',
    String.raw`C:\rules.json`,
    'C:rules.json',
    String.raw`\\host\rules.json`,
    String.raw`..\rules.json`,
  ])('rejects unsafe pack path %s', (rules) => {
    expect(() =>
      decodeLintPackManifest(JSON.stringify({ version: 1, id: pin.id, rules })),
    ).toThrow()
  })

  it.each([
    { version: 2, id: pin.id },
    { version: 1, id: '../pack' },
    { version: 1, id: 'pack' },
    { version: 1, id: pin.id, extra: true },
  ])('rejects invalid pack manifests %#', (value) => {
    expect(() => decodeLintPackManifest(JSON.stringify(value))).toThrow()
  })

  it('rejects empty or unknown-field pack rule documents', () => {
    expect(() => decodeLintPackRules('{"rules":[]}')).toThrow()
    expect(() => decodeLintPackRules(JSON.stringify({ rules: [rule], extra: true }))).toThrow()
    expect(decodeLintPackRules(JSON.stringify({ rules: [rule] }))).toEqual([rule])
  })

  it('merges in upstream order and overlays only upstream fields', () => {
    const base = {
      ...rule,
      allowSkip: true,
      allowAbstain: true,
      context: { callees: true },
      include: ['src/**'],
    }
    const cfg = read({
      languages: config.languages,
      packs: [pin],
      rules: [
        {
          id: 'one',
          include: [],
          exclude: ['test/**'],
          minConfidence: 0.8,
          exceptions: ['Exception'],
          kinds: ['function'],
          localize: ['statement'],
          allowSkip: false,
          allowAbstain: false,
          context: { callees: false },
        },
        { ...rule, id: 'two' },
      ],
    })
    const merged = mergeLintPacks(cfg, [
      { manifest, rules: decodeLintPackRules(JSON.stringify({ rules: [base] })) },
    ])
    expect(normalizeLintRules(merged)).toMatchObject([
      {
        id: 'one',
        include: [],
        exclude: ['test/**'],
        minConfidence: 0.8,
        allowSkip: true,
        allowAbstain: true,
        callees: true,
        exceptions: ['Exception'],
        localize: ['statement'],
        kinds: ['function'],
      },
      { id: 'two' },
    ])
    expect(cfg.rules?.[0]?.allowSkip).toBe(false)
  })

  it('refuses unresolved, mismatched, duplicate and unavailable-language packs', () => {
    const cfg = read({ ...config, packs: [pin], rules: [{ id: 'one' }] })
    expect(() => normalizeLintRules(cfg)).toThrow()
    expect(() => mergeLintPacks(cfg, [])).toThrow('lint-pack-pin-mismatch')
    expect(() =>
      mergeLintPacks(cfg, [{ manifest: { ...manifest, id: 'other/pack' }, rules: [rule] }]),
    ).toThrow('lint-pack-pin-mismatch')
    expect(() =>
      mergeLintPacks(cfg, [{ manifest: { ...manifest, languages: ['python'] }, rules: [rule] }]),
    ).toThrow('lint-pack-language-missing')
    expect(() => mergeLintPacks(cfg, [{ manifest, rules: [rule, rule] }])).toThrow(
      'lint-rule-id-duplicate',
    )
    expect(() =>
      mergeLintPacks({ ...cfg, rules: [{ id: 'unknown' }] }, [{ manifest, rules: [rule] }]),
    ).toThrow()
  })

  it('preserves upstream full overlays, null retention and pinned policy flags', () => {
    const cfg = read({
      languages: config.languages,
      packs: [pin],
      rules: [
        {
          ...rule,
          description: 'Changed criterion',
          severity: 'warning',
          include: null,
          exceptions: [],
          kinds: ['type'],
          localize: [],
          minConfidence: null,
          allowSkip: false,
          allowAbstain: false,
          context: null,
        },
      ],
    })
    const base = {
      ...rule,
      include: ['src/**'],
      exceptions: ['old'],
      kinds: ['function'] as const,
      localize: ['statement'] as const,
      minConfidence: 0.9,
      allowSkip: true,
      allowAbstain: true,
      context: { callees: true },
    }
    const packRules = decodeLintPackRules(JSON.stringify({ rules: [base] }))
    const merged = normalizeLintRules(mergeLintPacks(cfg, [{ manifest, rules: packRules }]))
    expect(merged[0]).toMatchObject({
      description: 'Changed criterion',
      severity: 'warning',
      include: ['src/**'],
      exceptions: [],
      kinds: ['type'],
      localize: [],
      minConfidence: 0.9,
      allowSkip: true,
      allowAbstain: true,
      callees: true,
    })
  })

  it('validates strict upstream eval cases and duplicate canonical rule/file pairs', () => {
    const cfg = read(config)
    const item = { rule: 'one', file: 'fixtures/pass.ts', expect: 'pass' }
    expect(decodeLintEvals(JSON.stringify({ version: 1, cases: [item] }), cfg).cases).toEqual([
      item,
    ])
    for (const value of [
      { version: 2, cases: [item] },
      { version: 1, cases: [] },
      { version: 1, cases: [item], extra: true },
      { version: 1, cases: [{ ...item, extra: true }] },
      { version: 1, cases: [{ ...item, rule: 'unknown' }] },
      { version: 1, cases: [{ ...item, file: '' }] },
      { version: 1, cases: [{ ...item, expect: 'skip' }] },
      { version: 1, cases: [item, { ...item, file: 'fixtures/../fixtures/pass.ts' }] },
    ])
      expect(() => decodeLintEvals(JSON.stringify(value), cfg)).toThrow()
  })
})
