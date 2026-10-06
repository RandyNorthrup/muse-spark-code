import { Usd } from '../../src/shared/usd'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  execEventSchema,
  execResultSchema,
  exitCodeFor,
  type ExecSignal,
  type ExecStatus,
  validateResult,
} from '../../src/runtime/exec/execProtocol'
import {
  EXEC_COMMAND,
  EXEC_MIN_OUTPUT_TOKENS,
  EXEC_MODEL_TEXT,
  EXEC_PROHIBITED_UPDATE_PATTERN,
  EXEC_PROTOCOL_VERSION,
  EXEC_RAW_TOOL_FIELDS,
  EXEC_SCAN_COMMAND,
  EXEC_SCAN_EXIT_FOUND,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  EXEC_WRITE_RETRY_MS,
} from '../../src/shared/constants'
import { resultRecord } from './helpers/execContract'

type JsonSchema = Readonly<Record<string, unknown>>

function isJsonType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'object': {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }
    case 'array': {
      return Array.isArray(value)
    }
    case 'null': {
      return value === null
    }
    default: {
      return typeof value === type
    }
  }
}

/**
 * The few JSON Schema keywords the shipped update rule uses ($ref, anyOf, not,
 * type, pattern, enum, required, items, propertyNames, properties,
 * additionalProperties), evaluated against `root`. Test-only: it checks the
 * committed schema enforces what execEventSchema enforces (RVM80A P2-2).
 */
function isMatch(schema: JsonSchema, value: unknown, root: JsonSchema): boolean {
  const reference = schema['$ref']
  if (typeof reference === 'string') {
    const name = reference.replace('#/$defs/', '')
    const definitions = root['$defs'] as Record<string, JsonSchema>
    if (!isMatch(definitions[name]!, value, root)) return false
  }
  const anyOf = schema['anyOf'] as JsonSchema[] | undefined
  if (anyOf?.every((option) => !isMatch(option, value, root)) === true) return false
  const not = schema['not'] as JsonSchema | undefined
  if (not !== undefined && isMatch(not, value, root)) return false
  const type = schema['type']
  if (type !== undefined && [type].flat().every((name) => !isJsonType(value, name))) return false
  const pattern = schema['pattern']
  if (
    typeof pattern === 'string' &&
    typeof value === 'string' &&
    !new RegExp(pattern, 'u').test(value)
  )
    return false
  const allowed = schema['enum'] as unknown[] | undefined
  if (allowed !== undefined && !allowed.includes(value)) return false
  if (Array.isArray(value)) {
    const items = schema['items'] as JsonSchema | undefined
    return items === undefined || value.every((item) => isMatch(items, item, root))
  }
  if (!isJsonType(value, 'object')) return true
  const record = value as Record<string, unknown>
  const required = (schema['required'] as string[] | undefined) ?? []
  if (required.some((key) => !Object.hasOwn(record, key))) return false
  const names = schema['propertyNames'] as JsonSchema | undefined
  if (names !== undefined && Object.keys(record).some((key) => !isMatch(names, key, root)))
    return false
  const properties = (schema['properties'] as Record<string, JsonSchema> | undefined) ?? {}
  const additional = schema['additionalProperties'] as JsonSchema | undefined
  return Object.entries(record).every(([key, item]) => {
    const rule = properties[key] ?? additional
    return rule === undefined || isMatch(rule, item, root)
  })
}

const statuses: [ExecStatus, number][] = [
  ['completed', 0],
  ['internal', 1],
  ['auth_required', 3],
  ['backend_unavailable', 3],
  ['failed', 4],
  ['budget_exceeded', 5],
  ['request_cap', 5],
  ['timeout', 6],
  ['denied', 7],
  ['incomplete', 8],
  ['accounting_unverified', 9],
]
describe('M80 schemas (A15/A16/F1)', () => {
  it.each(statuses)('A16 enforces %s = %i, error and null signal', (status, code) => {
    for (const signal of [null, 'SIGINT', 'SIGTERM'] as const) {
      const result = resultRecord()
      result.status = status
      result.exitCode = code
      result.signal = signal
      result.error = status === 'completed' ? null : { kind: 'stop', message: 'stopped' }
      expect(exitCodeFor(status, signal)).toBe(code)
      expect(execResultSchema.safeParse(result).success).toBe(signal === null)
      result.exitCode = 99
      expect(execResultSchema.safeParse(result).success).toBe(false)
    }
  })
  it.each<[ExecSignal, number]>([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])('A16 requires %s for cancelled/%i', (signal, exitCode) => {
    const result = {
      ...resultRecord(),
      status: 'cancelled',
      signal,
      exitCode,
      error: { kind: 'signal', message: 'stop' },
    }
    expect(validateResult(result)).toMatchObject({ signal, exitCode })
    expect(execResultSchema.safeParse({ ...result, signal: null }).success).toBe(false)
    expect(execResultSchema.safeParse({ ...result, error: null }).success).toBe(false)
  })
  it('A16/F1 compares mixed total costs in integer micro-USD, not binary equality', () => {
    const result = resultRecord()
    result.usage.costUsd = {
      settled: Usd.from(0.1).toAmount(),
      uncertain: Usd.from(0.2).toAmount(),
      reserved: Usd.from(0).toAmount(),
      total: Usd.from(0.3).toAmount(),
      isUpperBound: true,
    }
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(validateResult(result)).toEqual(result)
    for (const total of [0.108137, 0.1081343999999, -1, NaN, Infinity]) {
      expect(
        execResultSchema.safeParse({
          ...result,
          usage: { ...result.usage, costUsd: { ...result.usage.costUsd, total } },
        }).success,
      ).toBe(false)
    }
  })
  it('rejects a sub-micro USD field independently of cost addition', () => {
    const result = resultRecord()
    for (const settledUsd of [0.0000001, 0.0000004, 1.000000001]) {
      expect(
        execResultSchema.safeParse({
          ...result,
          usage: { ...result.usage, paid: { ...result.usage.paid, settledUsd } },
        }).success,
      ).toBe(false)
    }
  })
  it('rejects missing fields, unsafe counters, absolute paths, raw fields and incorrect uncertainty', () => {
    const result = resultRecord()
    const faults = [
      { ...result, error: { kind: 'x', message: 'bad' } },
      { ...result, signal: 'SIGINT' },
      { ...result, questionsDeclined: -1 },
      { ...result, questionsDeclined: 0.1 },
      { ...result, questionsDeclined: Number.MAX_SAFE_INTEGER + 1 },
      { ...result, durationMs: Infinity },
      { ...result, filesChanged: ['/tmp/x'] },
      { ...result, filesChanged: ['../x'] },
      { ...result, filesChanged: ['a//b'] },
      { ...result, filesChanged: ['a/./b'] },
      { ...result, filesChanged: ['C:/x'] },
      { ...result, filesChanged: [String.raw`a\b`] },
      { ...result, filesChanged: ['x', 'x'] },
      { ...result, inputs: [{ name: '/tmp/x', bytes: 0, chunks: 0, complete: true }] },
      { ...result, cwd: '/private' },
      { ...result, usage: { ...result.usage, cachedTokens: 11 } },
      { ...result, usage: { ...result.usage, reasoningTokens: 6 } },
      { ...result, usage: { ...result.usage, paid: { ...result.usage.paid, imagesReturned: 1 } } },
      {
        ...result,
        usage: {
          ...result.usage,
          costUsd: {
            settled: Usd.from(0).toAmount(),
            uncertain: Usd.from(1).toAmount(),
            reserved: Usd.from(0).toAmount(),
            total: Usd.from(1).toAmount(),
            isUpperBound: false,
          },
        },
      },
    ]
    for (const value of faults) expect(execResultSchema.safeParse(value).success).toBe(false)
    const { finalMessage: _message, ...missing } = result
    expect(execResultSchema.safeParse(missing).success).toBe(false)
  })
  it('keeps terminal/reason/usage after transport loss without allowing a priced claim', () => {
    const result = resultRecord()
    result.status = 'failed'
    result.exitCode = 4
    result.error = { kind: 'transport', message: 'aborted' }
    if (result.ledger?.lastResponse == null) throw new Error('fixture')
    Object.assign(result.ledger.lastResponse, {
      terminal: 'future_terminal',
      incompleteReason: 'future_reason',
      transportError: 'aborted',
      usage: 'invalid',
      settlement: 'full-reservation',
    })
    expect(validateResult(result).ledger?.lastResponse).toMatchObject({
      terminal: 'future_terminal',
      incompleteReason: 'future_reason',
      usage: 'invalid',
    })
    result.ledger.lastResponse.settlement = 'priced'
    expect(execResultSchema.safeParse(result).success).toBe(false)
  })
  it('R32 refuses completed without latest verified completion evidence', () => {
    const result = resultRecord()
    const last = result.ledger?.lastResponse
    if (last == null || result.ledger === null) throw new Error('fixture')
    for (const fault of [
      { terminal: 'incomplete' },
      { usage: 'missing' },
      { usage: 'invalid' },
      { settlement: 'full-reservation' },
      { transportError: 'aborted' },
      { endedWithoutTerminal: true },
    ]) {
      expect(
        execResultSchema.safeParse({
          ...result,
          ledger: { ...result.ledger, lastResponse: { ...last, ...fault } },
        }).success,
      ).toBe(false)
    }
    expect(execResultSchema.safeParse({ ...result, stopReason: 'cancelled' }).success).toBe(false)
    expect(execResultSchema.safeParse({ ...result, ledger: null }).success).toBe(false)
  })
  it('bounds HTTP metadata, attempt ordinals and result limits', () => {
    const result = resultRecord()
    const ledger = result.ledger
    if (ledger?.lastResponse == null) throw new Error('fixture')
    for (const change of [{ httpStatus: 99 }, { httpStatus: 600 }, { n: 0 }]) {
      expect(
        execResultSchema.safeParse({
          ...result,
          ledger: { ...ledger, lastResponse: { ...ledger.lastResponse, ...change } },
        }).success,
      ).toBe(false)
    }
    for (const change of [
      { budgetUsd: Usd.from(21).toAmount() },
      { budgetUsd: Usd.from(0).toAmount() },
      { maxRequests: 0 },
      { maxRequests: 501 },
      { timeoutSeconds: 9 },
      { timeoutSeconds: 21_601 },
    ]) {
      expect(
        execResultSchema.safeParse({ ...result, limits: { ...result.limits, ...change } }).success,
      ).toBe(false)
    }
  })
  it('keeps accounting fields consistent with the backend and cap', () => {
    const result = resultRecord()
    const muse = {
      ...result,
      backend: 'museCode',
      ledger: null,
      limits: { ...result.limits, budgetUsd: null, maxRequests: null },
      usage: { ...result.usage, requests: null, costUsd: null },
    }
    expect(execResultSchema.safeParse(muse).success).toBe(true)
    const faults = [
      { ...muse, ledger: result.ledger },
      { ...muse, usage: result.usage },
      { ...muse, usage: { ...muse.usage, paid: { ...muse.usage.paid, imageAttempts: 1 } } },
      { ...result, ledger: null },
      { ...result, usage: { ...result.usage, costUsd: null } },
      { ...result, usage: { ...result.usage, requests: null } },
      { ...result, limits: { ...result.limits, budgetUsd: Usd.from(2).toAmount() } },
      {
        ...result,
        usage: {
          ...result.usage,
          costUsd: {
            settled: Usd.from(2).toAmount(),
            uncertain: Usd.from(0).toAmount(),
            reserved: Usd.from(0).toAmount(),
            total: Usd.from(2).toAmount(),
            isUpperBound: false,
          },
        },
      },
    ]
    for (const value of faults) expect(execResultSchema.safeParse(value).success).toBe(false)
  })
  it('enforces event required fields, envelope enums and integer ledger identity', () => {
    const totals = {
      capUsd: Usd.from(1).toAmount(),
      settledUsd: Usd.from(0).toAmount(),
      uncertainUsd: Usd.from(0).toAmount(),
      reservedUsd: Usd.from(0.108135).toAmount(),
      remainingUsd: Usd.from(0.891865).toAmount(),
      requests: 1,
      tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
      paid: resultRecord().usage.paid,
      breach: false,
      refusal: null,
      lastResponse: null,
    }
    const event = {
      v: 2,
      seq: 1,
      time: '2026-10-02T00:00:00.000Z',
      type: 'attempt',
      n: 1,
      endpoint: 'responses',
      phase: 'admitted',
      reservedUsd: Usd.from(0.108135).toAmount(),
      totals,
    }
    expect(execEventSchema.safeParse(event).success).toBe(true)
    for (const change of [
      { seq: 0 },
      { time: 'yesterday' },
      { v: 1 },
      { endpoint: 'count' },
      { totals: { ...totals, remainingUsd: Usd.from(1).toAmount() } },
    ])
      expect(execEventSchema.safeParse({ ...event, ...change }).success).toBe(false)
  })
  it('A15 matches deterministic committed schemas and fails on field drift', async () => {
    const run = promisify(execFile)
    await expect(
      run(process.execPath, ['scripts/exec-schema.mjs', '--check']),
    ).resolves.toMatchObject({ stdout: 'Exec schemas match.\n' })
    for (const name of ['result', 'event']) {
      const raw: unknown = JSON.parse(
        await readFile(`docs/schemas/exec-${name}-v2.schema.json`, 'utf8'),
      )
      expect(raw).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' })
    }
  })
  it('npm run package:acp checks schema freshness before it packs', async () => {
    const manifest = await readFile('package.json', 'utf8')
    const steps = (/"package:acp": "([^"]*)"/.exec(manifest)?.[1] ?? '').split(' && ')
    const check = steps.indexOf('node scripts/exec-schema.mjs --check')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(steps.indexOf('node scripts/package-acp.mjs'))
  })
  it('RVM80A P2-2 the shipped event schema itself refuses what execEventSchema refuses in update', async () => {
    const root = JSON.parse(
      await readFile('docs/schemas/exec-event-v2.schema.json', 'utf8'),
    ) as JsonSchema
    const variants = root['anyOf'] as JsonSchema[]
    const update = variants.find(
      (variant) =>
        (variant['properties'] as Record<string, JsonSchema>)['type']?.['const'] === 'update',
    )
    const rule = (update?.['properties'] as Record<string, JsonSchema> | undefined)?.['update']
    if (rule === undefined) throw new Error('no update variant in the shipped schema')
    const samples: unknown[] = [
      { sessionUpdate: 'plan', entries: [{ content: 'x', priority: 1 }] },
      { sessionUpdate: 'future_non_tool', meta: { deep: [1, 'a', null, true] } },
      { sessionUpdate: 'agent_message_chunk', content: { text: 'x' } },
      { sessionUpdate: 'agent_thought_chunk', content: { text: 'x' } },
      { sessionUpdate: 'tool_call', title: 'x' },
      { sessionUpdate: 'tool_call_update' },
      { sessionUpdate: 'x', rawInput: {} },
      { sessionUpdate: 'x', nested: { rawOutput: 'x' } },
      { sessionUpdate: 'x', list: [{ toolCallId: '1' }] },
      { sessionUpdate: 'x', deep: { sessionUpdate: 'tool_call' } },
      { sessionUpdate: 'x', deep: { sessionUpdate: 5 } },
      { sessionUpdate: 'x', deep: { sessionUpdate: 'plan' } },
    ]
    const outcomes = samples.map((sample) => {
      const event = {
        v: 2,
        seq: 1,
        time: '2026-10-02T00:00:00.000Z',
        type: 'update',
        update: sample,
      }
      return [execEventSchema.safeParse(event).success, isMatch(rule, sample, root)]
    })
    for (const [index, [runtime, shipped]] of outcomes.entries()) {
      expect(shipped, JSON.stringify(samples[index])).toBe(runtime)
    }
    expect(outcomes.filter(([runtime]) => runtime)).toHaveLength(3)
  })
  it('RVM80A P3-1 refuses, never throws on, an amount past toFixed’s fixed-point range', () => {
    const result = resultRecord()
    result.usage.costUsd = {
      settled: Usd.from(1e21).toAmount(),
      uncertain: Usd.from(0).toAmount(),
      reserved: Usd.from(0).toAmount(),
      total: Usd.from(1e21).toAmount(),
      isUpperBound: false,
    }
    expect(() => execResultSchema.safeParse(result)).not.toThrow()
    expect(execResultSchema.safeParse(result).success).toBe(false)
    // A standalone amount has no sum identity behind it: its own micro-USD
    // check alone must refuse a value past the safe-integer range.
    const paid = {
      v: 2,
      seq: 1,
      time: '2026-10-02T00:00:00.000Z',
      type: 'paid_use',
      feature: 'imageGeneration',
      n: 1,
      phase: 'returned',
      units: 1,
      usd: Usd.from(1e21).toAmount(),
    }
    expect(() => execEventSchema.safeParse(paid)).not.toThrow()
    expect(execEventSchema.safeParse(paid).success).toBe(false)
    expect(execEventSchema.safeParse({ ...paid, usd: Usd.from(0.01).toAmount() }).success).toBe(
      true,
    )
  })
  it('exercises the lane-owned constant contract, including F1 units', async () => {
    // Named imports, not the module's entries: an enumeration would count every
    // export of constants.ts as used, and knip could see no dead constant (M91).
    const owned = {
      EXEC_COMMAND,
      EXEC_SCAN_COMMAND,
      EXEC_PROTOCOL_VERSION,
      EXEC_USD_UNITS,
      EXEC_USD_DECIMALS,
      EXEC_MIN_OUTPUT_TOKENS,
      EXEC_SCAN_EXIT_FOUND,
      EXEC_PROHIBITED_UPDATE_PATTERN,
      EXEC_RAW_TOOL_FIELDS,
      EXEC_WRITE_RETRY_MS,
    }
    expect(owned).toEqual({
      EXEC_COMMAND: 'exec',
      EXEC_SCAN_COMMAND: 'scan-secrets',
      EXEC_PROTOCOL_VERSION: 2,
      EXEC_USD_UNITS: 1_000_000,
      EXEC_USD_DECIMALS: 6,
      EXEC_MIN_OUTPUT_TOKENS: 16,
      EXEC_SCAN_EXIT_FOUND: 10,
      EXEC_PROHIBITED_UPDATE_PATTERN: '^(?:agent_(?:message|thought)_chunk|tool)',
      EXEC_RAW_TOOL_FIELDS: ['rawInput', 'rawOutput', 'toolCallId'],
      EXEC_WRITE_RETRY_MS: 10,
    })
    // 43 constants and EXEC_MODEL_TEXT, the run's model text, which only
    // the ACP agent reads (PLAN.md D6, 2026-10-04).
    const source = await readFile(new URL('../../src/shared/constants.ts', import.meta.url), 'utf8')
    expect(source.match(/^export const EXEC_\w+/gmu)).toHaveLength(44)
    expect(EXEC_MODEL_TEXT).toMatchObject({
      execUntrustedOpen: '<<<untrusted {marker}>>>',
      execUntrustedClose: '<<<end untrusted {marker}>>>',
    })
  })
})
