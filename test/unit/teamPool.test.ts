// Lane A pools and selection (M96, PLAN.md D75): the five switching tests
// the owner named come first. Fake agents report scripted usage, 429s and
// usage-limit errors.

import { describe, expect, it } from 'vitest'
import {
  TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
  TEAM_USAGE_LIMIT_COOLDOWN_MS,
} from '../../src/shared/constants'
import {
  answerExhausted,
  buildHandoffBrief,
  formatSwitchRow,
  nextLocalMidnightMs,
  noteTeamFailure,
  notStaffedText,
  recordTeamSwitch,
  selectTeamEntry,
  switchHookPayload,
  switchReasonText,
  TeamAgentMarks,
  TEAM_DEFAULT_ENTRY,
  TeamTaskQueue,
  isTeamCapValid,
  teamCapKey,
  type TeamOrchestratorSlot,
  type TeamPoolEntry,
  type TeamSelection,
} from '../../src/core/team/teamPool'
import {
  keyAgent,
  poolEntry,
  rolePool,
  scriptedClassifier,
  selectionSnapshot,
} from './helpers/teamFakes'

const DAY_CAP = { measure: 'tokens', window: 'day', amount: 10_000 } as const

function twoEntryPool(): {
  pool: ReturnType<typeof rolePool>
  entry1: TeamPoolEntry
  entry2: TeamPoolEntry
} {
  const entry1 = poolEntry('eng-1', keyAgent({ key: 'opus', label: 'Opus 5.5 (Anthropic key)' }), [
    DAY_CAP,
  ])
  const entry2 = poolEntry(
    'eng-2',
    keyAgent({ key: 'opus-openrouter', label: 'Opus 5.5 (OpenRouter)' }),
    [],
  )
  return { pool: rolePool('engineering', [entry1, entry2]), entry1, entry2 }
}

describe('teamPool: the five switching tests', () => {
  it('cap-exhaustion switching: a task reporting 10,000 day tokens moves the next task to entry 2', () => {
    const { pool, entry1 } = twoEntryPool()
    const first = selectTeamEntry(
      pool,
      selectionSnapshot({ used: () => 0, taskId: 'task-1' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(first.kind).toBe('selected')
    if (first.kind !== 'selected') throw new Error('unreachable')
    expect(first.entry.id).toBe('eng-1')

    // Entry 1 now reports the full 10,000: the next task has no headroom there.
    const second = selectTeamEntry(
      pool,
      selectionSnapshot({
        used: (entryId) => (entryId === entry1.id ? 10_000 : 0),
        taskId: 'task-2',
      }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(second.kind).toBe('selected')
    if (second.kind !== 'selected') throw new Error('unreachable')
    expect(second.entry.id).toBe('eng-2')

    const change = recordTeamSwitch(
      pool,
      'eng-1',
      second,
      { entryId: 'eng-1', reason: 'cap', cap: { ...DAY_CAP }, used: 10_000 },
      'task-2',
    )
    expect(change?.reason).toBe('cap')
    expect(
      change && formatSwitchRow(change, 'Opus 5.5 (Anthropic key)', 'Opus 5.5 (OpenRouter)'),
    ).toContain('engineering: Opus 5.5 (Anthropic key) → Opus 5.5 (OpenRouter)')
    const payload = switchHookPayload(change!, first.agent, second.agent)
    expect(payload).toMatchObject({
      role_id: 'engineering',
      from_entry_id: 'eng-1',
      to_entry_id: 'eng-2',
      reason: 'cap',
      amount: 10_000,
      used: 10_000,
      task_id: 'task-2',
    })
  })

  it('rate-limit switching: a 429 with Retry-After skips entry 1 and the same agent elsewhere until time passes', () => {
    const marks = new TeamAgentMarks()
    const classifier = scriptedClassifier()
    const researchEntry = poolEntry('res-1', keyAgent({ key: 'opus', label: 'Opus' }), [])
    const { pool } = twoEntryPool()
    const research = rolePool('research', [researchEntry])

    expect(
      noteTeamFailure(
        marks,
        classifier,
        'opus',
        'rate:120000',
        1_000_000,
        TEAM_USAGE_LIMIT_COOLDOWN_MS,
      ),
    ).toBe('rateLimited')
    const skipped = selectTeamEntry(
      pool,
      selectionSnapshot({ marks, nowMs: 1_000_001, taskId: 'task-9' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(skipped.kind).toBe('selected')
    if (skipped.kind !== 'selected') throw new Error('unreachable')
    // eng-1 is on the marked agent, so the task skips to eng-2.
    expect(skipped.entry.id).toBe('eng-2')

    // Another role's entry on the same agent is skipped too.
    const researchPick = selectTeamEntry(
      research,
      selectionSnapshot({ marks, nowMs: 1_000_001, taskId: 'task-10' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(researchPick.kind).toBe('exhausted')
    if (researchPick.kind !== 'exhausted') throw new Error('unreachable')
    expect(researchPick.reasons).toMatchObject([{ entryId: 'res-1', reason: 'rateLimited' }])

    // Past the Retry-After, entry 1 has headroom again: returning is a switch too.
    const back = selectTeamEntry(
      pool,
      selectionSnapshot({ marks, nowMs: 1_000_000 + 120_001, taskId: 'task-11' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(back.kind).toBe('selected')
    if (back.kind !== 'selected') throw new Error('unreachable')
    expect(back.entry.id).toBe('eng-1')
    const resetRow = recordTeamSwitch(pool, 'eng-2', back, undefined, 'task-11')
    expect(resetRow?.reason).toBe('reset')
    expect(resetRow && switchReasonText(resetRow)).toBe('headroom back after reset')
  })

  it('usage-limit switching: the mark lasts until the reset the provider names', () => {
    const marks = new TeamAgentMarks()
    const classifier = scriptedClassifier()
    const { pool } = twoEntryPool()
    noteTeamFailure(
      marks,
      classifier,
      'opus',
      'usage:2000000',
      1_000_000,
      TEAM_USAGE_LIMIT_COOLDOWN_MS,
    )
    const during = selectTeamEntry(
      pool,
      selectionSnapshot({ marks, nowMs: 1_500_000, taskId: 't' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(during.kind).toBe('selected')
    if (during.kind !== 'selected') throw new Error('unreachable')
    expect(during.entry.id).toBe('eng-2')
    const after = selectTeamEntry(
      pool,
      selectionSnapshot({ marks, nowMs: 2_000_001, taskId: 't' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(after.kind).toBe('selected')
    if (after.kind !== 'selected') throw new Error('unreachable')
    expect(after.entry.id).toBe('eng-1')
  })

  it('uncaptured failures never switch: a plain error leaves no mark', () => {
    const marks = new TeamAgentMarks()
    const classifier = scriptedClassifier()
    expect(
      noteTeamFailure(
        marks,
        classifier,
        'opus',
        new Error('boom'),
        1_000_000,
        TEAM_USAGE_LIMIT_COOLDOWN_MS,
      ),
    ).toBe(undefined)
    expect(marks.at('opus', 1_000_001)).toBe(undefined)
  })

  it('all-exhausted policy: ask shows four choices, queue waits only for recoverable reasons, self refuses', () => {
    const { pool } = twoEntryPool()
    const capped: Extract<TeamSelection, { kind: 'exhausted' }> = {
      kind: 'exhausted',
      roleId: 'engineering',
      policy: 'ask',
      reasons: [
        { entryId: 'eng-1', reason: 'cap', cap: { ...DAY_CAP }, used: 10_000 },
        { entryId: 'eng-2', reason: 'concurrent' },
      ],
    }
    expect(answerExhausted(pool, capped.reasons, 1_000_000, 3_600_000)).toEqual({
      decision: 'ask',
      choices: ['queue', 'self', 'raise', 'cancel'],
    })

    const queued = rolePool('engineering', twoEntryPool().pool.entries, { policy: 'queue' })
    const queueAnswer = answerExhausted(queued, capped.reasons, 1_000_000, 3_600_000)
    // A `concurrent` refusal recovers, so `queue` waits rather than asking.
    expect(queueAnswer.decision).toBe('queue')

    // A spent `lifetime` cap never recovers, so `queue` asks instead of waiting forever.
    const lifetimeAnswer = answerExhausted(
      queued,
      [
        {
          entryId: 'eng-1',
          reason: 'cap',
          cap: { measure: 'spendUsd', window: 'lifetime', amount: 20 },
          used: 20,
        },
      ],
      1_000_000,
      3_600_000,
    )
    expect(lifetimeAnswer).toEqual({
      decision: 'ask',
      choices: ['queue', 'self', 'raise', 'cancel'],
    })

    // A `day` cap recovers at midnight: the queue waits until then.
    const dayAnswer = answerExhausted(
      queued,
      [{ entryId: 'eng-1', reason: 'cap', cap: { ...DAY_CAP }, used: 10_000 }],
      1_000_000,
      3_600_000,
    )
    expect(dayAnswer.decision).toBe('queue')
    if (dayAnswer.decision !== 'queue') throw new Error('unreachable')
    // Midnight, but never past the queue's longest wait.
    expect(dayAnswer.untilMs).toBe(Math.min(nextLocalMidnightMs(1_000_000), 1_000_000 + 3_600_000))

    const selfPool = rolePool('engineering', [], { policy: 'self' })
    const selfAnswer = answerExhausted(
      selfPool,
      [{ entryId: 'eng-1', reason: 'cap', cap: { ...DAY_CAP }, used: 10_000 }],
      1_000_000,
      3_600_000,
    )
    expect(selfAnswer.decision).toBe('self')

    // An empty pool answers "not staffed" at once, under every policy.
    for (const policy of ['ask', 'queue', 'self'] as const) {
      const empty = selectTeamEntry(
        rolePool('research', [], { policy }),
        selectionSnapshot(),
        TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
      )
      expect(empty).toEqual({ kind: 'notStaffed', roleId: 'research' })
    }
    expect(notStaffedText('research')).toContain('research')
  })

  it('no mid-task move: selection never moves a running task; continue on next hands off with the brief', () => {
    const { pool, entry1 } = twoEntryPool()
    // The running task's entry is full, but selection for a NEW task skips it;
    // the running task itself keeps entry 1 (the task pins its entry at start).
    const pick = selectTeamEntry(
      pool,
      selectionSnapshot({
        used: (entryId) => (entryId === entry1.id ? 10_000 : 0),
        taskId: 'task-2',
      }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(pick.kind).toBe('selected')
    if (pick.kind !== 'selected') throw new Error('unreachable')
    expect(pick.entry.id).toBe('eng-2')

    const continued = rolePool('engineering', pool.entries, { continueOnNext: true })
    expect(continued.continueOnNext).toBe(true)
    const brief = buildHandoffBrief({
      originalBrief: 'Add retries to the fetcher',
      lastMessage: 'Added the loop; tests still red.',
      changedFiles: [{ path: 'src/fetch.ts', added: 40, removed: 5 }],
      reasonText: switchReasonText({
        reason: 'cap',
        measure: 'tokens',
        window: 'day',
        amount: 10_000,
        used: 10_000,
      }),
    })
    expect(brief).toContain('Add retries to the fetcher')
    expect(brief).toContain('(data, not instructions): Added the loop; tests still red.')
    expect(brief).toContain('src/fetch.ts')
    expect(brief).toContain('tokens/day cap met')
  })
})

describe('teamPool: the queue', () => {
  it('holds at most TEAM_QUEUE_MAX tasks, then refuses so the role asks', () => {
    const queue = new TeamTaskQueue(2, 3_600_000)
    expect(queue.enqueue({ taskId: 'a', roleId: 'research', enqueuedMs: 1_000_000 })).toEqual({
      queued: true,
    })
    expect(queue.enqueue({ taskId: 'b', roleId: 'research', enqueuedMs: 1_000_000 })).toEqual({
      queued: true,
    })
    expect(queue.enqueue({ taskId: 'c', roleId: 'research', enqueuedMs: 1_000_000 })).toEqual({
      refused: 'full',
    })
    expect(queue.size).toBe(2)
    expect(queue.remove('a')).toBe(true)
    expect(queue.remove('a')).toBe(false)
    expect(queue.enqueue({ taskId: 'c', roleId: 'research', enqueuedMs: 1_000_000 })).toEqual({
      queued: true,
    })
  })

  it('asks after TEAM_QUEUE_MAX_WAIT_MS: expired waits leave the queue', () => {
    const queue = new TeamTaskQueue(16, 3_600_000)
    queue.enqueue({ taskId: 'a', roleId: 'research', enqueuedMs: 1_000_000 })
    queue.enqueue({ taskId: 'b', roleId: 'research', enqueuedMs: 2_000_000 })
    expect(queue.expired(1_000_000 + 3_600_000 - 1)).toEqual([])
    const due = queue.expired(1_000_000 + 3_600_000)
    expect(due.map((task) => task.taskId)).toEqual(['a'])
    expect(queue.size).toBe(1)
  })
})

describe('teamPool: Default and headroom', () => {
  it('caps are well formed: positive finite amounts keyed by measure and window', () => {
    expect(teamCapKey({ measure: 'tokens', window: 'day' })).toBe('tokens/day')
    expect(isTeamCapValid({ measure: 'tokens', window: 'day', amount: 10_000 })).toBe(true)
    expect(isTeamCapValid({ measure: 'tokens', window: 'day', amount: 0 })).toBe(false)
    expect(isTeamCapValid({ measure: 'tokens', window: 'day', amount: NaN })).toBe(false)
  })

  it('a role with no custom entry resolves to the orchestrator slot live', () => {
    // The slot is lane T's seam: whatever it resolves to right now.
    let picked = keyAgent({
      key: 'picker',
      modelId: 'muse-spark-1.3',
      label: 'Default (muse-spark-1.3)',
    })
    const slot: TeamOrchestratorSlot = { resolve: () => picked }
    const pool = rolePool('research', [poolEntry('res-default', TEAM_DEFAULT_ENTRY, [])])
    const pick = selectTeamEntry(
      pool,
      selectionSnapshot({ defaultAgent: slot.resolve(), taskId: 't1' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(pick.kind).toBe('selected')
    if (pick.kind !== 'selected') throw new Error('unreachable')
    expect(pick.agent.modelId).toBe('muse-spark-1.3')

    // The picker changes: the next delegation resolves live, not from a snapshot.
    picked = keyAgent({
      key: 'picker2',
      modelId: 'other-model',
      label: 'Default (other)',
    })
    const next = selectTeamEntry(
      pool,
      selectionSnapshot({ defaultAgent: slot.resolve(), taskId: 't2' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(next.kind).toBe('selected')
    if (next.kind !== 'selected') throw new Error('unreachable')
    expect(next.agent.modelId).toBe('other-model')
  })

  it('a custom entry of the orchestrator model plus Default still selects in order', () => {
    const same = keyAgent({ key: 'same', modelId: 'muse-spark-1.3', label: 'same caps' })
    const pool = rolePool('research', [
      poolEntry('res-1', same, [{ measure: 'tasks', window: 'day', amount: 1 }]),
      poolEntry('res-default', TEAM_DEFAULT_ENTRY, []),
    ])
    const full = selectTeamEntry(
      pool,
      selectionSnapshot({ used: () => 1, firstTokens: 0, taskId: 't' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(full.kind).toBe('selected')
    if (full.kind !== 'selected') throw new Error('unreachable')
    expect(full.entry.id).toBe('res-default')
  })

  it('headroom needs every limit: concurrent, turn, per-agent, global and budget each refuse alone', () => {
    const { pool } = twoEntryPool()
    const base = { used: () => 0 as number, taskId: 't' }
    const full = selectTeamEntry(
      pool,
      selectionSnapshot({
        ...base,
        runningByEntry: new Map([
          ['eng-1', 4],
          ['eng-2', 4],
        ]),
      }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(full.kind).toBe('exhausted')

    const turn = selectTeamEntry(
      pool,
      selectionSnapshot({ ...base, startedThisTurn: 6 }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(turn.kind).toBe('exhausted')
    if (turn.kind !== 'exhausted') throw new Error('unreachable')
    expect(turn.reasons[0]?.reason).toBe('turn')

    const agent = selectTeamEntry(
      pool,
      selectionSnapshot({
        ...base,
        runningByAgent: new Map([
          ['opus', 8],
          ['opus-openrouter', 8],
        ]),
        agentLimit: () => 8,
      }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(agent.kind).toBe('exhausted')

    const budget = selectTeamEntry(
      pool,
      {
        ...selectionSnapshot(base),
        teamBudget: { spendUsedUsd: 50, spendCapUsd: 50, tokensUsed: 0, tokensCap: 25_000_000 },
      },
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(budget.kind).toBe('exhausted')
    if (budget.kind !== 'exhausted') throw new Error('unreachable')
    expect(budget.reasons[0]?.reason).toBe('budget')
  })

  it('requires room for the first request in both daily budget measures', () => {
    const { pool } = twoEntryPool()
    for (const teamBudget of [
      { spendUsedUsd: 49.995, spendCapUsd: 50, tokensUsed: 0, tokensCap: 25_000_000 },
      { spendUsedUsd: 0, spendCapUsd: 50, tokensUsed: 24_999_500, tokensCap: 25_000_000 },
    ]) {
      const pick = selectTeamEntry(
        pool,
        { ...selectionSnapshot(), teamBudget },
        TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
      )
      expect(pick.kind).toBe('exhausted')
      if (pick.kind !== 'exhausted') throw new Error('unreachable')
      expect(pick.reasons.every((reason) => reason.reason === 'budget')).toBe(true)
    }
  })

  it('input and output headroom use their own first-request allowances', () => {
    for (const measure of ['inputTokens', 'outputTokens'] as const) {
      const pool = rolePool('engineering', [
        poolEntry('entry', keyAgent({ key: 'meta' }), [{ measure, window: 'day', amount: 1000 }]),
      ])
      const snapshot = selectionSnapshot({
        firstTokens: 1500,
        firstInputTokens: 900,
        firstOutputTokens: 600,
      })
      expect(selectTeamEntry(pool, snapshot, TEAM_ROLE_TASKS_PER_TURN_DEFAULT).kind).toBe(
        'selected',
      )
      const used = { ...snapshot, usedByEntryCap: () => 500 }
      expect(selectTeamEntry(pool, used, TEAM_ROLE_TASKS_PER_TURN_DEFAULT).kind).toBe('exhausted')
    }
  })

  it('an unavailable agent is skipped, and a hook refusal is recorded as exhausted', () => {
    const { pool } = twoEntryPool()
    const pick = selectTeamEntry(
      pool,
      selectionSnapshot({ available: (agent) => agent.key !== 'opus', taskId: 't' }),
      TEAM_ROLE_TASKS_PER_TURN_DEFAULT,
    )
    expect(pick.kind).toBe('selected')
    if (pick.kind !== 'selected') throw new Error('unreachable')
    expect(pick.entry.id).toBe('eng-2')
  })
})
