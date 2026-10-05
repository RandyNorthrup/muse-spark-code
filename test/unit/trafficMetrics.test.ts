import { describe, expect, it } from 'vitest'
import { trafficMetrics, type TrafficMetricSource } from '../../src/core/team/trafficMetrics'
import { type TeamAttempt } from '../../src/shared/team'

const now = new Date(2026, 9, 5, 12).getTime()
const day = new Date(2026, 9, 5).getTime()
const minute = 60_000
function attempt(entryId: string, accuracy: 'reported' | 'estimated', cost: number): TeamAttempt {
  return {
    number: 1,
    entryId,
    agentProfileId: entryId,
    modelId: 'model',
    kind: 'engine',
    state: 'retired',
    startedAt: day + minute * 10,
    endedAt: day + minute * 20,
    retirement: { kind: 'userDecision' },
    usage: {
      inputTokens: 100,
      cachedInputTokens: 50,
      outputTokens: 20,
      reasoningTokens: 10,
      modelCalls: 1,
      costUsd: cost,
      accuracy,
    },
  }
}
function seed(): TrafficMetricSource {
  const base = { roleId: 'engineering', writing: true, reviewRounds: 2 }
  return {
    tasks: [
      {
        ...base,
        id: 'a',
        createdAt: day,
        mergedAt: day + minute * 30,
        attempts: [attempt('one', 'reported', 2), { ...attempt('two', 'estimated', 1), number: 2 }],
      },
      {
        ...base,
        id: 'b',
        createdAt: day,
        mergedAt: day + minute * 50,
        attempts: [attempt('one', 'reported', 4)],
      },
      { ...base, id: 'c', createdAt: day, attempts: [attempt('one', 'reported', 50)] },
    ],
    events: [
      { workspaceId: 'ws', kind: 'ready', taskId: 'a', attempt: 1, at: day + minute * 5 },
      { workspaceId: 'ws', kind: 'started', taskId: 'a', attempt: 1, at: day + minute * 10 },
      { workspaceId: 'ws', kind: 'ready', taskId: 'b', attempt: 1, at: day + minute * 5 },
      { workspaceId: 'ws', kind: 'started', taskId: 'b', attempt: 1, at: day + minute * 20 },
      { kind: 'reviewRound', round: 1, taskId: 'a', attempt: 1, at: day + minute * 21 },
      { kind: 'reviewRound', round: 2, taskId: 'a', attempt: 1, at: day + minute * 22 },
      { kind: 'mergeConflict', taskId: 'a', attempt: 1, at: day + minute * 23 },
      {
        workspaceId: 'ws',
        kind: 'reassigned',
        taskId: 'a',
        attempt: 1,
        at: day + minute * 24,
        fromEntryId: 'one',
        toEntryId: 'two',
        reason: 'noProgress',
      },
      {
        workspaceId: 'ws',
        kind: 'predictedConflict',
        taskId: 'a',
        attempt: 1,
        at: day + minute * 25,
        otherTaskId: 'b',
        paths: ['src/a.ts'],
      },
      {
        workspaceId: 'ws',
        kind: 'candidateReturned',
        taskId: 'b',
        attempt: 1,
        at: day + minute * 26,
        reason: 'check failed',
      },
      {
        workspaceId: 'ws',
        kind: 'blocked',
        taskId: 'c',
        attempt: 1,
        at: day + minute * 27,
        reason: 'dependency',
      },
      { kind: 'finished', taskId: 'c', attempt: 1, at: day + minute * 28 },
    ],
    slots: [
      {
        groupId: 'entry-one',
        roleId: 'engineering',
        entryId: 'one',
        agentProfileId: 'one',
        at: day - minute,
        busy: 1,
        slots: 2,
      },
      {
        groupId: 'entry-one',
        roleId: 'engineering',
        entryId: 'one',
        agentProfileId: 'one',
        at: day + minute * 30,
        busy: 0,
        slots: 2,
      },
    ],
  }
}
describe('Traffic ledger metrics', () => {
  it('matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs', () => {
    const result = trafficMetrics(seed(), { period: 'today' }, now)
    expect(result.busySlotMs).toBe(minute * 30)
    expect(result.availableSlotMs).toBe(minute * 60 * 12 * 2)
    expect(result.waitMedianMs).toBe(minute * 10)
    expect(result.waitP90Ms).toBe(minute * 15)
    expect(result.writingTasks).toBe(3)
    expect(result.predictedConflicts).toBe(1)
    expect(result.mergeConflicts).toBe(1)
    expect(result.reworkRounds).toBe(1)
    expect(result.reassignments).toBe(1)
    expect(result.candidatesReturned).toBe(1)
    expect(result.mergedChanges).toBe(2)
    expect(result.reportedCostUsd).toBe(6)
    expect(result.estimatedCostUsd).toBe(1)
    expect(result.reportedTokens).toBe(240)
    expect(result.estimatedTokens).toBe(120)
    expect(result.timeToMergeMedianMs).toBe(minute * 40)
    expect(result.queueDepth).toContainEqual({ at: day + minute * 5, ready: 2, blocked: 0 })
    expect(result.queueDepth.at(-1)).toEqual({ at: day + minute * 28, ready: 0, blocked: 0 })
  })
  it('attributes every matching attempt separately without counting nonmerged cost or token subsets twice', () => {
    const result = trafficMetrics(
      seed(),
      { period: 'allTime', roleId: 'engineering', entryId: 'two', agentProfileId: 'two' },
      now,
    )
    expect(result.reportedCostUsd).toBe(0)
    expect(result.estimatedCostUsd).toBe(1)
    expect(result.estimatedTokens).toBe(120)
    expect(result.mergedChanges).toBe(1)
    expect(result.waitMedianMs).toBeNull()
    expect(result.availableSlotMs).toBe(0)
  })
  it('uses local calendar periods, clips slot intervals and carries earlier queue state across midnight', () => {
    const source = seed()
    const task = source.tasks[0]
    if (!task) throw new Error('fixture task missing')
    const old = new Date(2026, 9, 4, 23, 59).getTime()
    const result = trafficMetrics(
      {
        ...source,
        tasks: [{ ...task, createdAt: old }],
        events: [
          { workspaceId: 'ws', kind: 'ready', taskId: 'a', attempt: 1, at: old },
          { workspaceId: 'ws', kind: 'started', taskId: 'a', attempt: 1, at: day + minute },
        ],
      },
      { period: 'today' },
      now,
    )
    expect(result.waitMedianMs).toBe(minute * 2)
    expect(result.queueDepth[0]).toEqual({ at: day, ready: 1, blocked: 0 })
    expect(result.writingTasks).toBe(0)
    expect(result.reportedCostUsd).toBe(2)
    expect(trafficMetrics(source, { period: 'week' }, now).writingTasks).toBe(3)
  })
  it('keeps missing samples null and refuses impossible capacity', () => {
    const empty = trafficMetrics({ tasks: [], events: [], slots: [] }, { period: 'allTime' }, now)
    expect(empty.waitMedianMs).toBeNull()
    expect(empty.waitP90Ms).toBeNull()
    expect(empty.timeToMergeMedianMs).toBeNull()
    expect(() =>
      trafficMetrics(
        { tasks: [], events: [], slots: [{ groupId: 'bad', at: 0, busy: 2, slots: 1 }] },
        { period: 'allTime' },
        now,
      ),
    ).toThrow('Invalid scheduler slot observation')
  })
})
