// Lane E's spend authority (M101 C-M101-3, part A): the real shared D78
// admission over a real ledger against the run budget — reserve and settle
// per attempt, refuse past the budget, on unknown usage or on abort, and
// fail closed without a bound parent admission.

import { describe, expect, it } from 'vitest'
import { resolveAutoCompactModel } from '../../../src/core/backends/modelapi/autoCompactionAdmission'
import type { AutoCompactDecision } from '../../../src/core/backends/modelapi/autoCompact'
import {
  AUTO_COMPACTION_ARM,
  freezeEvalHarness,
  frozenBundleChange,
} from '../../../src/core/eval/mechanisms'
import { bindEvalAdmission, createEvalCompactionLedger } from '../../../src/core/eval/driver'
import type { EvalBudget } from '../../../src/core/eval/wire'
import { EVAL_TASKS, evalWindowTokens } from '../../../src/core/eval/tasks'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../../src/shared/constants'
import { Usd } from '../../../src/shared/usd'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from '../helpers/fakeModelApi'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'
import { driveEvalTurn, testEvalAdmission } from '../helpers/evalTurn'
import { compactionArmReplies } from './evalFixes'

function budget(): EvalBudget {
  return { spentUsd: Usd.from(0).toAmount() }
}

const CENT = Usd.from(0.01).toAmount()

async function reserve(overrides: Partial<EvalBudget> = {}) {
  const run = { ...budget(), ...overrides }
  const ledger = createEvalCompactionLedger(run)
  const claim = await ledger.reserveCompaction(CENT, new AbortController().signal)
  // A missing claim would vacate every assertion below; fail loudly instead.
  expect(claim).toBeDefined()
  if (claim === undefined) throw new Error('the ledger must admit a cent from an empty budget')
  return { run, ledger, claim }
}

function admissionRequest() {
  const model = resolveAutoCompactModel(EVAL_MODEL_ID)
  expect(model).toBeDefined()
  if (model === undefined) throw new Error('the contributor model must be priced')
  const decision: AutoCompactDecision = {
    reason: 'overflow',
    newDebt: 0,
    saving: 1,
    breakEvenRequests: 1,
    writeReadRatio: undefined,
  }
  return {
    sessionId: 'session',
    turnId: 'turn',
    modelId: EVAL_MODEL_ID,
    model,
    decision,
    signal: new AbortController().signal,
  }
}

function hostBase() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  return fakeModelApiHostDeps({
    client: fakeModelApiClient(api, log),
    workspaceRoot: '/ws',
    io,
    log,
  })
}

describe('the evaluation ledger', () => {
  it('reserves and settles one attempt, releasing its reservation', async () => {
    const { run, ledger, claim } = await reserve()
    expect(claim.reservedUsd).toBe(CENT)
    claim.check()
    await claim.settle(Usd.from(0).toAmount(), false)
    expect(ledger.tally.settled).toBe(1)
    expect(run.hasUnknownUsage).toBeUndefined()
    // The released reservation admits again: settling never double-counts
    // the trace's own spend, so the full budget still reserves.
    const again = await ledger.reserveCompaction(
      Usd.from(EVAL_BUDGET_USD).toAmount(),
      new AbortController().signal,
    )
    expect(again?.reservedUsd).toBe(Usd.from(EVAL_BUDGET_USD).toAmount())
  })

  it('settles an unknown cost by stopping the run, not by charging it', async () => {
    const { run, claim } = await reserve()
    await claim.settle(Usd.from(0).toAmount(), true)
    expect(run.hasUnknownUsage).toBe(true)
    expect(run.spentUsd).toBe(Usd.from(0).toAmount())
  })

  it('counts a repeated settle once', async () => {
    const { ledger, claim } = await reserve()
    await claim.settle(Usd.from(0).toAmount(), false)
    await claim.settle(Usd.from(0).toAmount(), false)
    expect(ledger.tally.settled).toBe(1)
  })

  it('refuses past the run budget', async () => {
    const run = budget()
    const ledger = createEvalCompactionLedger(run)
    await expect(
      ledger.reserveCompaction(
        Usd.from(EVAL_BUDGET_USD + 1).toAmount(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('the run budget cannot cover it')
    run.spentUsd = Usd.from(EVAL_BUDGET_USD).toAmount()
    await expect(ledger.reserveCompaction(CENT, new AbortController().signal)).rejects.toThrow(
      'the run budget cannot cover it',
    )
  })

  it('rechecks the budget synchronously at send time', async () => {
    const { run, claim } = await reserve()
    run.spentUsd = Usd.from(EVAL_BUDGET_USD).toAmount()
    expect(() => {
      claim.check()
    }).toThrow('the run budget is spent')
  })

  it('refuses once a sent call has unknown usage', async () => {
    const { run, claim } = await reserve()
    run.hasUnknownUsage = true
    expect(() => {
      claim.check()
    }).toThrow('a sent model call has unknown usage')
    const stopped = createEvalCompactionLedger({ ...budget(), hasUnknownUsage: true })
    await expect(stopped.reserveCompaction(CENT, new AbortController().signal)).rejects.toThrow(
      'a sent model call has unknown usage',
    )
  })

  it('refuses on abort', async () => {
    const ledger = createEvalCompactionLedger(budget())
    const controller = new AbortController()
    controller.abort()
    let failure: unknown = 'sent'
    try {
      await ledger.reserveCompaction(CENT, controller.signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).name).toBe('AbortError')
  })
})

describe('the frozen auto-compaction change', () => {
  it('fails closed without the admission its parent binds', () => {
    const frozen = freezeEvalHarness([AUTO_COMPACTION_ARM], [])
    const bundle = frozen.bundles.get(AUTO_COMPACTION_ARM.name)
    expect(bundle).toBeDefined()
    if (bundle === undefined) throw new Error('the auto-compaction arm must freeze')
    const changed = frozenBundleChange(bundle)(hostBase())
    expect(changed.admitAutoCompaction).toBeDefined()
    // The wrapper refuses synchronously, before any request is read.
    expect(() => changed.admitAutoCompaction!(admissionRequest())).toThrow(
      'the auto-compaction arm needs the evaluation admission its parent binds',
    )
  })

  it('fails the turn instead of running uncompacted without the admission its parent binds', async () => {
    const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-long-compaction')
    expect(task).toBeDefined()
    if (task === undefined) throw new Error('the long-context task is missing')
    // No admission bound: the host must rethrow the frozen arm's marker
    // instead of continuing uncompacted as if that were the mechanism.
    const { outcome } = await driveEvalTurn({
      replies: compactionArmReplies(task),
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
      prompt: task.prompt,
      change: AUTO_COMPACTION_ARM.change,
      windowTokens: evalWindowTokens(task),
      admission: null,
    })
    expect(outcome.terminal).toBe('failed')
    expect(outcome.reason).toContain('the auto-compaction arm needs the evaluation admission')
  })

  it('delegates to the admission its parent binds', async () => {
    const log = new FakeLogOutputChannel()
    const admission = testEvalAdmission()
    const base = { ...hostBase(), autoCompaction: () => true, autoCompactionEvaluated: () => true }
    const bound = bindEvalAdmission(base, admission, log, () => base)
    const changed = AUTO_COMPACTION_ARM.change!(bound)
    const admitted = await changed.admitAutoCompaction!(admissionRequest())
    expect(admitted).toBeDefined()
    expect(typeof admitted?.guard).toBe('function')
    expect(admission.ledger.tally.started).toBe(0)
  })
})

describe('the bound admission switches', () => {
  it('admits only as evaluated: the baseline stays declined', async () => {
    const log = new FakeLogOutputChannel()
    const admission = testEvalAdmission()
    const armed = {
      ...hostBase(),
      autoCompaction: () => true,
      autoCompactionEvaluated: () => false,
    }
    const bound = bindEvalAdmission(hostBase(), admission, log, () => armed)
    await expect(bound.admitAutoCompaction!(admissionRequest())).resolves.toBeUndefined()
  })

  it('carries reserved, known settled and retained unknown money from the ledger', async () => {
    const budget = { spentUsd: Usd.from(0).toAmount() }
    const ledger = createEvalCompactionLedger(budget)
    const amount = Usd.from('0.01').toAmount()
    const actual = Usd.from('0.002').toAmount()
    const claim = await ledger.reserveCompaction(amount, new AbortController().signal)
    expect(ledger.tally.reservedUsd).toBe(amount)
    expect(ledger.tally.outstandingUsd).toBe(amount)
    await claim?.settle(actual, false)
    await claim?.settle(actual, false)
    expect(ledger.tally.settledUsd).toBe(actual)
    expect(ledger.tally.outstandingUsd).toBe(Usd.from(0).toAmount())
    const unknown = await ledger.reserveCompaction(amount, new AbortController().signal)
    await unknown?.settle(amount, true)
    expect(ledger.tally.retainedUsd).toBe(amount)
    expect(ledger.tally.reservedUsd).toBe(Usd.from(amount).times(2).toAmount())
    expect(ledger.tally.settledUsd).toBe(actual)
    // The trace owns spend; ledger receipts never double-charge it.
    expect(budget.spentUsd).toBe(Usd.from(0).toAmount())
  })

  it('tallies started attempts; settling without a reservation settles nothing', async () => {
    const log = new FakeLogOutputChannel()
    const admission = testEvalAdmission()
    const armed = {
      ...hostBase(),
      autoCompaction: () => true,
      autoCompactionEvaluated: () => true,
    }
    const bound = bindEvalAdmission(hostBase(), admission, log, () => armed)
    const admitted = await bound.admitAutoCompaction!(admissionRequest())
    expect(admitted).toBeDefined()
    admitted?.guard.onRequestStarted?.()
    expect(admission.ledger.tally.started).toBe(1)
    // No reservation was made (prepareRequest never ran), so settling and
    // closing are safe no-ops: only a reserved claim settles, exactly once.
    await admitted?.settle(EVAL_MODEL_ID, undefined, 'uncertain')
    await admitted?.close?.()
    expect(admission.ledger.tally.settled).toBe(0)
  })
})
