import { describe, expect, it } from 'vitest'
import { createRunLedger, type ResponseTicket } from '../../src/runtime/exec/runLedger'
import { Usd } from '../../src/shared/usd'

const amount = (value: string) => Usd.from(value).toAmount()
const price = { input: amount('1'), cachedInput: amount('1'), output: amount('1') }
const completed = {
  kind: 'eof' as const,
  terminal: 'completed',
  incompleteReason: null,
  parseInvalid: false,
  usage: { input_tokens: 1, output_tokens: 1 },
}
function reserve(ledger: ReturnType<typeof createRunLedger>, cost = '0.4'): ResponseTicket {
  const ticket = ledger.admitResponse({
    model: 'worker',
    maxOutputTokens: 100,
    price,
    reserveUsd: amount(cost),
  })
  if ('refused' in ticket) throw new Error(ticket.refused)
  return ticket
}

describe('M96b concurrent headless reservations', () => {
  it('holds every concurrent worker reservation before dispatch', () => {
    const ledger = createRunLedger({ capUsd: amount('1'), maxRequests: 100, concurrent: true })
    const first = reserve(ledger)
    const second = reserve(ledger)
    expect(ledger.totals()).toMatchObject({
      reservedUsd: amount('0.8'),
      remainingUsd: amount('0.2'),
    })
    expect(() => reserve(ledger)).toThrow('budget')
    ledger.settleResponse(second, completed)
    expect(ledger.totals().reservedUsd).toBe(amount('0.4'))
    const third = reserve(ledger)
    ledger.settleResponse(first, completed)
    ledger.settleResponse(third, completed)
    expect(ledger.totals()).toMatchObject({ reservedUsd: amount('0'), requests: 3 })
  })
  it('retains uncertain workers while other workers settle', () => {
    const ledger = createRunLedger({ capUsd: amount('1'), maxRequests: 100, concurrent: true })
    const lost = reserve(ledger)
    const known = reserve(ledger)
    ledger.settleResponse(lost, {
      kind: 'transport',
      why: 'aborted',
      terminal: null,
      incompleteReason: null,
      usage: undefined,
    })
    ledger.settleResponse(known, completed)
    expect(ledger.totals().uncertainUsd).toBe(amount('0.4'))
    reserve(ledger)
    expect(() => reserve(ledger)).toThrow('budget')
  })
  it('refunds only an owned unsent attempt, once', () => {
    const ledger = createRunLedger({ capUsd: amount('1'), maxRequests: 100, concurrent: true })
    const first = reserve(ledger)
    reserve(ledger)
    ledger.releaseUnsent(first)
    expect(ledger.totals()).toMatchObject({ reservedUsd: amount('0.4'), uncertainUsd: amount('0') })
    expect(() => {
      ledger.releaseUnsent(first)
    }).toThrow()
    expect(() => ledger.settleResponse(first, completed)).toThrow()
  })
  it('counts zero-cost local requests and refuses after close', () => {
    const ledger = createRunLedger({ capUsd: amount('1'), maxRequests: 2, concurrent: true })
    reserve(ledger, '0')
    reserve(ledger, '0')
    expect(() => reserve(ledger, '0')).toThrow('requests')
    ledger.close()
    expect(() => reserve(ledger, '0')).toThrow('closed')
  })
})

it('worker settlements preserve the orchestrator terminal and observe their own attempt', () => {
  const ledger = createRunLedger({ capUsd: amount('1'), maxRequests: 100, concurrent: true })
  const parent = reserve(ledger)
  ledger.settleResponse(parent, completed)
  const terminal = ledger.lastResponse
  const worker = ledger.admitResponse({
    model: 'worker',
    maxOutputTokens: 100,
    price,
    reserveUsd: amount('0.4'),
    recordsLastResponse: false,
  })
  if ('refused' in worker) throw new Error(worker.refused)
  expect(ledger.lastResponse).toEqual(terminal)
  const observed: number[] = []
  ledger.settleResponse(worker, completed, undefined, (outcome) => {
    observed.push(outcome.n)
  })
  expect(observed).toEqual([worker.n])
  expect(ledger.lastResponse).toEqual(terminal)
})

it('repository lowering caps all workers together without expanding the run allowance', () => {
  const ledger = createRunLedger({ capUsd: amount('2'), maxRequests: 100, concurrent: true })
  ledger.lowerWorkerCap(amount('0.5'))
  const worker = ledger.admitResponse({
    model: 'worker',
    maxOutputTokens: 100,
    price,
    reserveUsd: amount('0.4'),
    recordsLastResponse: false,
  })
  if ('refused' in worker) throw new Error(worker.refused)
  expect(
    ledger.admitResponse({
      model: 'worker',
      maxOutputTokens: 100,
      price,
      reserveUsd: amount('0.4'),
      recordsLastResponse: false,
    }),
  ).toEqual({ refused: 'budget' })
  reserve(ledger, '1')
  expect(() => {
    ledger.lowerWorkerCap(amount('1'))
  }).toThrow()
  ledger.settleResponse(worker, {
    kind: 'transport',
    why: 'error',
    terminal: null,
    incompleteReason: null,
    usage: undefined,
  })
  expect(
    ledger.admitResponse({
      model: 'worker',
      maxOutputTokens: 100,
      price,
      reserveUsd: amount('0.4'),
      recordsLastResponse: false,
    }),
  ).toEqual({ refused: 'budget' })
})
