import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import {
  isHeadlessPaidUseAllowed,
  parseExec,
  serveOptionsFor,
} from '../../src/runtime/exec/execArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  capRefusalReason,
  validateToolResultCap,
} from '../../src/core/backends/modelapi/toolResultBound'
import { PAID_PRICES_USD, UI_TEXT } from '../../src/shared/constants'
import type { PaidUseRequest } from '../../src/shared/paid'
import { fill } from '../../src/shared/l10n/text'

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
  it('runs headless compaction only with its explicit flag, and the off flag wins', () => {
    const plain = parseExec({}, ['hi'])
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.options.paidFeatures).toEqual([])
    expect(plain.options.autoCompaction).toBe(false)
    // Automatic compaction is a Model API engine feature: the default
    // Muse Code backend refuses the flag instead of accepting a no-op.
    expect(parseExec({ 'auto-compaction': true }, ['hi'])).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    const modelApi = { backend: 'modelApi', 'max-budget-usd': '1' }
    const flagged = parseExec({ ...modelApi, 'auto-compaction': true }, ['hi'])
    if (!flagged.ok) throw new Error(flagged.reason)
    expect(flagged.options.paidFeatures).toEqual(['autoCompaction'])
    expect(flagged.options.autoCompaction).toBe(true)
    expect(serveOptionsFor(flagged.options).autoCompaction).toBe(true)
    const off = parseExec({ ...modelApi, 'auto-compaction': true, 'no-auto-compaction': true }, [
      'hi',
    ])
    if (!off.ok) throw new Error(off.reason)
    expect(off.options.paidFeatures).toEqual(['autoCompaction'])
    expect(off.options.autoCompaction).toBe(false)
    expect(
      parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--auto-compaction',
        'hi',
      ]),
    ).toMatchObject({
      command: 'exec',
      options: { autoCompaction: true, paidFeatures: ['autoCompaction'] },
    })
  })
  it('admits headless paid uses only with a flag and a remaining run budget', () => {
    const compaction: PaidUseRequest = {
      feature: 'autoCompaction',
      modelId: 'muse-spark-1.3',
      dailyBudgetUsd: Usd.from(5).toAmount(),
    }
    const image: PaidUseRequest = {
      feature: 'imageGeneration',
      kind: 'generate',
      path: 'image.png',
      sources: [],
      prompt: 'a picture',
    }
    const rich = {
      paidFeatures: ['autoCompaction', 'imageGeneration'] as const,
      mode: 'acceptEdits' as const,
    }
    const richUsd = Usd.from(2).toAmount()
    // Compaction: flag plus any remaining budget; no budget means no run.
    expect(isHeadlessPaidUseAllowed(rich, richUsd, false, compaction, false)).toBe(true)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: [], mode: 'acceptEdits' },
        richUsd,
        false,
        compaction,
        false,
      ),
    ).toBe(false)
    expect(isHeadlessPaidUseAllowed(rich, Usd.from(0).toAmount(), false, compaction, false)).toBe(
      false,
    )
    // Images keep their own rule: flag, acceptEdits and an affordable budget.
    expect(isHeadlessPaidUseAllowed(rich, richUsd, false, image, false)).toBe(true)
    expect(isHeadlessPaidUseAllowed(rich, richUsd, false, image, true)).toBe(false)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: ['imageGeneration'], mode: 'plan' },
        richUsd,
        false,
        image,
        false,
      ),
    ).toBe(false)
    expect(
      isHeadlessPaidUseAllowed(
        rich,
        Usd.from(PAID_PRICES_USD.imageGeneration).toAmount(),
        false,
        image,
        false,
      ),
    ).toBe(true)
    // Asking and aborted runs admit nothing.
    expect(isHeadlessPaidUseAllowed(rich, richUsd, false, compaction, true)).toBe(false)
    expect(isHeadlessPaidUseAllowed(rich, richUsd, true, compaction, false)).toBe(false)
    const search: PaidUseRequest = { feature: 'webSearch', priceUsd: Usd.from(1).toAmount() }
    expect(isHeadlessPaidUseAllowed(rich, richUsd, false, search, false)).toBe(false)
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
      timeoutMs: undefined,
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
  it('leaves no request limit without --max-requests and accepts any positive count', () => {
    // No provider publishes a request-count maximum, so a set value has none.
    const parsed = parseExec({ backend: 'modelApi', 'max-budget-usd': '1' }, ['hi'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.maxRequests).toBeUndefined()
    for (const value of ['0', '-1', 'abc', '10x']) {
      expect(
        parseExec({ backend: 'modelApi', 'max-budget-usd': '1', 'max-requests': value }, ['hi']).ok,
      ).toBe(false)
    }
    for (const value of ['1', '500', '501', '1000000']) {
      const accepted = parseExec(
        { backend: 'modelApi', 'max-budget-usd': '1', 'max-requests': value },
        ['hi'],
      )
      expect(accepted.ok).toBe(true)
      if (!accepted.ok) throw new Error(accepted.reason)
      expect(accepted.options.maxRequests).toBe(Number(value))
    }
  })
  it.each([
    '0',
    '-1',
    'abc',
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
    // Above-$20 budgets from the recorded real CLI exchange in
    // docs/certification/pr228fix.md (2026-10-18, rig macmini).
    ['20.01', 20_010_000],
    ['250.50', 250_500_000],
    ['250.5', 250_500_000],
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
    { timeout: '0' },
    { backend: 'modelApi', 'max-budget-usd': '1', 'max-requests': '0' },
    { backend: 'modelApi', 'max-budget-usd': '1', 'max-tool-output-bytes': '1023' },
    { backend: 'museCode', 'max-tool-output-bytes': '70000' },
    { timeout: '10.1' },
    { backend: ['modelApi'] },
    { unknown: true },
    { 'untrusted-file': ['x', 1] },
  ])('A4–A7 refuse unsafe/conflicting/unknown options %j', (values) => {
    expect(parseExec(values, ['hi']).ok).toBe(false)
  })
  it('keeps the policy cap without the flag and refuses a value above it at parsing', () => {
    const base = { backend: 'modelApi', 'max-budget-usd': '1' }
    const plain = parseExec(base, ['hi'])
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.options.maxOutputTokens).toBeUndefined()
    const lowered = parseExec({ ...base, 'max-output-tokens': '2000' }, ['hi'])
    expect(lowered.ok && lowered.options.maxOutputTokens).toBe(2000)
    expect(parseExec({ ...base, 'max-output-tokens': '32768' }, ['hi']).ok).toBe(true)
    expect(parseExec({ ...base, 'max-output-tokens': '32769' }, ['hi'])).toEqual({
      ok: false,
      reason: fill(UI_TEXT.execOutputCapExceeded, { cap: '32768' }),
    })
    for (const bad of ['0', '1.5', 'many'])
      expect(parseExec({ ...base, 'max-output-tokens': bad }, ['hi'])).toEqual({
        ok: false,
        reason: fill(UI_TEXT.execLimitInvalid, { flag: '--max-output-tokens' }),
      })
    // The parse floor stays 1: a provider that permits fewer than Meta's 16
    // output tokens keeps 1 through 15 as valid caps, and the selected
    // model's own minimum applies at admission and at the send.
    for (const small of ['1', '15'])
      expect(parseExec({ ...base, 'max-output-tokens': small }, ['hi'])).toMatchObject({
        ok: true,
        options: { maxOutputTokens: Number(small) },
      })
    expect(parseExec({ backend: 'museCode', 'max-output-tokens': '2000' }, ['hi'])).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    expect(
      parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--max-output-tokens',
        '2000',
        'hi',
      ]),
    ).toMatchObject({ command: 'exec', options: { maxOutputTokens: 2000 } })
  })

  it('leaves no deadline without --timeout and honors any positive duration', () => {
    // No provider publishes a run deadline, so the product sets neither a
    // default nor a maximum; 0, negatives and non-numbers are not a time.
    const unset = parseExec({}, ['hi'])
    expect(unset.ok).toBe(true)
    if (!unset.ok) throw new Error(unset.reason)
    expect(unset.options.timeoutMs).toBeUndefined()
    for (const value of ['0', '-1', 'abc', '10x']) {
      expect(parseExec({ timeout: value }, ['hi']).ok).toBe(false)
    }
    for (const value of ['1', '9', '10', '21601', '1000000']) {
      const accepted = parseExec({ timeout: value }, ['hi'])
      expect(accepted.ok).toBe(true)
      if (!accepted.ok) throw new Error(accepted.reason)
      expect(accepted.options.timeoutMs).toBe(Number(value) * 1000)
    }
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
      'max-tool-output-bytes': '128000',
      'prompt-file': '/prompt',
      'untrusted-file': ['a', 'b'],
    }
    const parsed = parseExec(values, [])
    expect(parsed.ok && parsed.options).toMatchObject({
      prompt: { kind: 'file', path: '/prompt' },
      paidFeatures: ['imageGeneration'],
      timeoutMs: 10_000,
      maxRequests: 1,
      maxToolOutputBytes: 128_000,
      budgetUsd: Usd.from('2').toAmount(),
    })
    expect(parseExec({}, ['-'])).toMatchObject({ ok: true, options: { prompt: { kind: 'stdin' } } })
  })
  it('TOOLCAP refuses a below-floor tool-output guard with its translated sentence', () => {
    const values = { backend: 'modelApi', 'max-budget-usd': '1' }
    expect(parseExec({ ...values, 'max-tool-output-bytes': '10' }, ['hi'])).toEqual({
      ok: false,
      reason: capRefusalReason({ kind: 'below-floor' }),
    })
    expect(parseExec({ ...values, 'max-tool-output-bytes': 'abc' }, ['hi'])).toEqual({
      ok: false,
      reason: UI_TEXT.execNumberInvalid,
    })
    const floor = parseExec({ ...values, 'max-tool-output-bytes': '1024' }, ['hi'])
    if (!floor.ok) throw new Error(floor.reason)
    expect(floor.options.maxToolOutputBytes).toBe(1024)
  })

  it('TOOLCAP takes an explicit 0 tool-output guard as no guard of ours', () => {
    const values = { backend: 'modelApi', 'max-budget-usd': '1' }
    const parsed = parseExec({ ...values, 'max-tool-output-bytes': '0' }, ['hi'])
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.maxToolOutputBytes).toBe(0)
    expect(validateToolResultCap(parsed.options.maxToolOutputBytes, undefined)).toEqual({
      bytes: Infinity,
    })
  })
  it('accepts --effort none for Thinking off (lane REASONSHAPESR2)', () => {
    // The terminal agent can be told to send none; the record decides
    // what the wire carries.
    expect(parseExec({ effort: 'none' }, ['hi'])).toMatchObject({
      ok: true,
      options: { effort: 'none' },
    })
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
