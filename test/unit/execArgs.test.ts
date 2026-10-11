import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import { parseExec, serveOptionsFor } from '../../src/runtime/exec/execArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { UI_TEXT } from '../../src/shared/constants'

describe('M80 args (A1–A10, F1)', () => {
  it('shares the automatic compaction opt-out between ACP and headless', () => {
    expect(parseCommandLine(['--no-auto-compaction'])).toMatchObject({
      command: 'serve',
      options: { autoCompaction: false },
    })
    const parsed = parseExec({ 'no-auto-compaction': true }, ['hi'])
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(serveOptionsFor(parsed.options).autoCompaction).toBe(false)
    expect(parseCommandLine(['exec', '--no-auto-compaction', 'hi'])).toMatchObject({
      command: 'exec',
      options: { autoCompaction: false },
    })
  })
  it('M106 accepts a schema file only on the bounded Model API path and omits the unused option', () => {
    const values = { backend: 'modelApi', 'max-budget-usd': '1' }
    const plain = parseExec(values, ['task'])
    expect(plain.ok && Object.hasOwn(plain.options, 'outputSchema')).toBe(false)
    expect(parseExec({ ...values, 'output-schema': 'answer.json' }, ['task'])).toMatchObject({
      ok: true,
      options: { outputSchema: 'answer.json' },
    })
    for (const outputSchema of ['', true, ['schema.json']])
      expect(parseExec({ ...values, 'output-schema': outputSchema }, ['task']).ok).toBe(false)
    expect(parseExec({ 'output-schema': 'answer.json' }, ['task'])).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
  })
  it('requires the outside-schema flag to be explicit and paired with a Model API schema', () => {
    const values = {
      backend: 'modelApi',
      'max-budget-usd': '1',
      'output-schema': 'answer.json',
      'output-schema-outside': true,
    }
    expect(parseExec(values, ['task'])).toMatchObject({
      ok: true,
      options: { outputSchema: 'answer.json', outputSchemaOutside: true },
    })
    expect(parseExec({ 'output-schema-outside': true }, ['task']).ok).toBe(false)
    expect(
      parseExec({ backend: 'modelApi', 'max-budget-usd': '1', 'output-schema-outside': true }, [
        'task',
      ]).ok,
    ).toBe(false)
    expect(parseExec({ ...values, 'output-schema-outside': 'true' }, ['task']).ok).toBe(false)
  })
  it('A1 keeps safe Muse Code defaults and projects an untrusted serve session', () => {
    const parsed = parseExec({}, ['hi'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options).toMatchObject({
      backend: 'museCode',
      mode: 'plan',
      output: 'text',
      timeoutMs: 1_800_000,
      prompt: { kind: 'text', text: 'hi' },
      maxRequests: undefined,
      paidFeatures: [],
    })
    expect(serveOptionsFor(parsed.options)).toMatchObject({
      trustWorkspace: false,
      canBypass: false,
      backend: 'museCode',
    })
  })
  it('A2 requires an explicit Model API budget', () => {
    expect(parseExec({ backend: 'modelApi' }, ['hi'])).toEqual({
      ok: false,
      reason: UI_TEXT.execBudgetRequired,
    })
  })
  it.each([
    '0',
    '-1',
    'abc',
    '20.01',
    'Infinity',
    '+1',
    '1e0',
    '１',
    ' 1',
    '1 ',
    '.5',
    '1.',
    '0.108134399999999999999',
    '0.0000001',
    '1.0000000',
  ])('A3/F1 rejects decimal %s before conversion', (value) => {
    expect(parseExec({ backend: 'modelApi', 'max-budget-usd': value }, ['hi']).ok).toBe(false)
  })
  it('F1 rejects trailing line terminators instead of accepting a numeric prefix', () => {
    for (const ending of ['\n', '\r', '\r\n', '\u{2028}', '\u{2029}']) {
      expect(parseExec({ backend: 'modelApi', 'max-budget-usd': `1${ending}` }, ['hi']).ok).toBe(
        false,
      )
      expect(parseExec({ timeout: `10${ending}` }, ['hi']).ok).toBe(false)
    }
  })
  it.each([
    ['0.000001', 1],
    ['0.108134', 108_134],
    ['0.108135', 108_135],
    ['1.409024', 1_409_024],
    ['20.000000', 20_000_000],
    ['0001.000001', 1_000_001],
  ])('F1 parses %s directly into exact micro-USD', (value, units) => {
    const parsed = parseExec({ backend: 'modelApi', 'max-budget-usd': value }, ['hi'])
    if (!parsed.ok || parsed.options.budgetUsd === undefined) throw new Error('budget was refused')
    expect(Usd.from(parsed.options.budgetUsd).units(6)).toBe(BigInt(units))
    expect(parsed.options.budgetUsd).toBe(Usd.from(value).toAmount())
  })
  it.each([
    { 'trust-workspace': true },
    { 'allow-dangerously-skip-permissions': true },
    ...['auto', 'manual', 'bypassPermissions', 'future'].map((mode) => ({
      'permission-mode': mode,
    })),
    { 'web-search': true },
    { 'image-generation': true },
    { backend: 'modelApi', 'max-budget-usd': '1', 'image-generation': true },
    { backend: 'modelApi', 'max-budget-usd': '1', 'muse-binary': '/muse' },
    { backend: 'modelApi', 'max-budget-usd': '1', 'shell-sandbox': 'off' },
    { 'max-requests': '1' },
    { ephemeral: true },
    { 'key-stdin': true },
    { backend: 'auto' },
    { output: 'xml' },
    { effort: 'unknown' },
    { timeout: '9' },
    { timeout: '21601' },
    { backend: 'modelApi', 'max-budget-usd': '1', 'max-requests': '501' },
    { timeout: '10.1' },
    { backend: ['modelApi'] },
    { unknown: true },
    { 'untrusted-file': ['x', 1] },
  ])('A4–A7 refuse unsafe/conflicting/unknown options %j', (values) => {
    expect(parseExec(values, ['hi']).ok).toBe(false)
  })
  it('accepts full bounded Model API options and the two alternate prompt sources', () => {
    const values = {
      backend: 'modelApi',
      'max-budget-usd': '2',
      'permission-mode': 'acceptEdits',
      'image-generation': true,
      'key-stdin': true,
      ephemeral: true,
      verbose: true,
      cwd: '/work',
      model: 'muse-spark',
      effort: 'high',
      output: 'jsonl',
      'allow-contributor-models': true,
      'fail-on-denial': true,
      timeout: '10',
      'max-requests': '1',
      'prompt-file': '/prompt',
      'untrusted-file': ['a', 'b'],
    }
    const parsed = parseExec(values, [])
    expect(parsed.ok && parsed.options).toMatchObject({
      prompt: { kind: 'file', path: '/prompt' },
      paidFeatures: ['imageGeneration'],
      timeoutMs: 10_000,
      maxRequests: 1,
      budgetUsd: Usd.from('2').toAmount(),
    })
    expect(parseExec({}, ['-'])).toMatchObject({ ok: true, options: { prompt: { kind: 'stdin' } } })
  })
  it('A8 refuses duplicate, missing and shared stdin sources', () => {
    for (const positions of [[], [''], ['a', 'b']]) expect(parseExec({}, positions).ok).toBe(false)
    expect(parseExec({ 'prompt-file': 'file' }, ['hi']).ok).toBe(false)
    expect(parseExec({ 'prompt-file': '' }, []).ok).toBe(false)
    expect(
      parseExec({ backend: 'modelApi', 'max-budget-usd': '1', 'key-stdin': true }, ['-']).ok,
    ).toBe(false)
  })
  it('A9 bounds files and literal prompt bytes without truncation', () => {
    expect(parseExec({ 'untrusted-file': Array.from({ length: 9 }, () => 'x') }, ['hi']).ok).toBe(
      false,
    )
    expect(parseExec({}, ['x'.repeat(262_144)]).ok).toBe(true)
    expect(parseExec({}, ['é'.repeat(131_073)]).ok).toBe(false)
  })
  it('A10 leaves the existing serve command parser unchanged', () => {
    expect(parseCommandLine(['--output', 'json'])).toMatchObject({ command: 'invalid' })
  })
})
