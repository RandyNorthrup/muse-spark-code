import {
  TEAM_DEFAULT_ENTRY,
  type TeamRolePool,
  type TeamSelectionSnapshot,
} from '../../../src/core/team/teamPool'
import { keyAgent, poolEntry, rolePool, selectionSnapshot } from './teamFixtures'
import { Usd } from '../../../src/shared/usd'

// The legacy D75 selection receipts: the same fourteen cases, fed to the
// real selector and compared byte-exact with the recorded run.

export function legacySelectionCases(): readonly {
  name: string
  pool: TeamRolePool
  snapshot: TeamSelectionSnapshot
}[] {
  const first = keyAgent({ key: 'preferred', modelId: 'first-model' })
  const second = keyAgent({ key: 'fallback', modelId: 'second-model' })
  const pool = rolePool('engineering', [
    poolEntry('first', first, [], 1),
    poolEntry('second', second, [], 1),
  ])
  const rate = selectionSnapshot({ nowMs: 0 })
  rate.marks.markRateLimited('preferred', 100)
  const usage = selectionSnapshot({ nowMs: 0 })
  usage.marks.markUsageLimit('preferred', 100)
  const expired = selectionSnapshot({ nowMs: 100 })
  expired.marks.markRateLimited('preferred', 100)
  const snapshot = selectionSnapshot()
  const cap = [{ measure: 'tokens' as const, window: 'day' as const, amount: 1 }]
  return [
    { name: 'preferred', pool, snapshot },
    {
      name: 'default',
      pool: rolePool('engineering', [poolEntry('default', TEAM_DEFAULT_ENTRY)]),
      snapshot,
    },
    {
      name: 'busy-entry',
      pool,
      snapshot: selectionSnapshot({ runningByEntry: new Map([['first', 1]]) }),
    },
    {
      name: 'busy-agent',
      pool,
      snapshot: selectionSnapshot({
        runningByAgent: new Map([['preferred', 1]]),
        agentLimit: () => 1,
      }),
    },
    { name: 'rate-limit', pool, snapshot: rate },
    { name: 'usage-limit', pool, snapshot: usage },
    { name: 'expired-mark', pool, snapshot: expired },
    {
      name: 'unavailable',
      pool,
      snapshot: selectionSnapshot({ available: (agent) => agent.key !== 'preferred' }),
    },
    {
      name: 'all-capped',
      pool: rolePool('engineering', [
        poolEntry('first', first, cap),
        poolEntry('second', second, cap),
      ]),
      snapshot,
    },
    { name: 'not-staffed', pool: rolePool('engineering', []), snapshot },
    {
      name: 'turn-limit',
      pool: { ...pool, tasksPerTurn: 1 },
      snapshot: selectionSnapshot({ startedThisTurn: 1 }),
    },
    { name: 'global-limit', pool, snapshot: { ...snapshot, global: { running: 1, limit: 1 } } },
    {
      name: 'process-limit',
      pool: rolePool('engineering', [
        poolEntry('first', { ...first, kind: 'external' }),
        poolEntry('second', second),
      ]),
      snapshot: { ...snapshot, process: { running: 1, limit: 1 } },
    },
    {
      name: 'team-budget',
      pool,
      snapshot: {
        ...snapshot,
        teamBudget: {
          spendUsedUsd: Usd.from(0).toAmount(),
          spendCapUsd: Usd.from(0).toAmount(),
          tokensUsed: 0,
          tokensCap: 100,
        },
      },
    },
  ]
}
