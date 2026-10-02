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
import * as constants from '../../src/shared/constants'
import { resultRecord } from './helpers/execContract'

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
      settled: 0.1,
      uncertain: 0.2,
      reserved: 0,
      total: 0.3,
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
          costUsd: { settled: 0, uncertain: 1, reserved: 0, total: 1, isUpperBound: false },
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
      { budgetUsd: 21 },
      { budgetUsd: 0 },
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
      { ...result, limits: { ...result.limits, budgetUsd: 2 } },
      {
        ...result,
        usage: {
          ...result.usage,
          costUsd: { settled: 2, uncertain: 0, reserved: 0, total: 2, isUpperBound: false },
        },
      },
    ]
    for (const value of faults) expect(execResultSchema.safeParse(value).success).toBe(false)
  })
  it('enforces event required fields, envelope enums and integer ledger identity', () => {
    const totals = {
      capUsd: 1,
      settledUsd: 0,
      uncertainUsd: 0,
      reservedUsd: 0.108135,
      remainingUsd: 0.891865,
      requests: 1,
      tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
      paid: resultRecord().usage.paid,
      breach: false,
      refusal: null,
      lastResponse: null,
    }
    const event = {
      v: 1,
      seq: 1,
      time: '2026-10-02T00:00:00.000Z',
      type: 'attempt',
      n: 1,
      endpoint: 'responses',
      phase: 'admitted',
      reservedUsd: 0.108135,
      totals,
    }
    expect(execEventSchema.safeParse(event).success).toBe(true)
    for (const change of [
      { seq: 0 },
      { time: 'yesterday' },
      { v: 2 },
      { endpoint: 'count' },
      { totals: { ...totals, remainingUsd: 1 } },
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
        await readFile(`docs/schemas/exec-${name}-v1.schema.json`, 'utf8'),
      )
      expect(raw).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' })
    }
  })
  it('exercises the lane-owned constant contract, including F1 units', () => {
    const owned = Object.fromEntries(
      Object.entries(constants).filter(([name]) => name.startsWith('EXEC_')),
    )
    expect(owned).toMatchObject({
      EXEC_COMMAND: 'exec',
      EXEC_SCAN_COMMAND: 'scan-secrets',
      EXEC_PROTOCOL_VERSION: 1,
      EXEC_USD_UNITS: 1_000_000,
      EXEC_USD_DECIMALS: 6,
      EXEC_MIN_OUTPUT_TOKENS: 16,
      EXEC_SCAN_EXIT_FOUND: 10,
    })
    expect(Object.keys(owned)).toHaveLength(40)
    expect(constants.MODEL_TEXT).toMatchObject({
      execUntrustedOpen: '<<<untrusted {marker}>>>',
      execUntrustedClose: '<<<end untrusted {marker}>>>',
    })
  })
})
