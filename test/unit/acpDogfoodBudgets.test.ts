import { describe, expect, it } from 'vitest'
import { createAcpAccounting } from '../../src/runtime/acpAccounting'
import { Usd } from '../../src/shared/usd'
import type { UsageBudgetRead } from '../../src/core/usage/usageService'
import { createUsageRecording } from '../../src/core/usage/recording'
import { FakeLogOutputChannel } from './helpers/fakes'

function accounting(exact: UsageBudgetRead['exact']) {
  const log = new FakeLogOutputChannel()
  const recording = createUsageRecording({
    client: 'test',
    now: () => 0,
    newId: () => 'id',
    isEnabled: () => false,
    writer: () => Promise.reject(new Error('disabled')),
    log,
  })
  return createAcpAccounting({
    recording,
    isEnabled: () => true,
    // No ledger exists here: readExisting must not create one for a usage view.
    dataFolder: 'temp/acpdog-no-budget-ledger',
    now: () => 0,
    sleep: () => Promise.resolve(),
    runtime: {
      readUsageBudgets: () =>
        Promise.resolve([
          {
            budget: {
              id: 'session',
              kind: 'conversation',
              capUsd: 1,
              spentUsd: 0.1,
              stopped: false,
            },
            ...(exact !== undefined && { exact }),
          },
        ]),
    },
  })
}

describe('ACPDOG exact ACP budget projection', () => {
  it('uses ledger decimals without round-tripping the display numbers', async () => {
    const view = accounting({
      capUsd: Usd.from(1).toAmount(),
      spentUsd: Usd.from('0.100000000000000001').toAmount(),
      uncertainUsd: Usd.from(0).toAmount(),
      hasUnknownCost: false,
    })
    const budgets = await view.readBudgets('session')
    expect(budgets.find((budget) => budget.scope === 'session')).toEqual({
      scope: 'session',
      capUsd: '1',
      spentUsd: '0.100000000000000001',
      remainingUsd: '0.899999999999999999',
      uncertainUsd: '0',
      hasUnknownCost: false,
    })
  })
  it('refuses an approximate budget snapshot instead of claiming exact remaining money', async () => {
    await expect(accounting(undefined).readBudgets('session')).rejects.toThrow(
      'Exact usage budget unavailable',
    )
  })
})
