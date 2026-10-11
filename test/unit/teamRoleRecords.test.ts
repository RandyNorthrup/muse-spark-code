import { describe, expect, it } from 'vitest'
import { readTeamRoleRecords, TEAM_TASKS_STATE_KEY } from '../../src/core/team/teamTaskState'
import { TEAM_LEARNED_RECENT_TASKS, UI_TEXT } from '../../src/shared/constants'

function row(taskId: string, input: number, phase = 'done', role = 'engineering') {
  return {
    taskId,
    role: { role, pool: [] },
    brief: '',
    files: [],
    reason: 'parallel',
    sessionId: 'parent',
    startMs: input,
    endMs: input + 1,
    phase,
    usage: { input, output: 2, cachedInput: input, reasoning: 1, modelCalls: 1, estimated: false },
  }
}
function state(raw: unknown) {
  return { get: (key: string) => (key === TEAM_TASKS_STATE_KEY ? raw : undefined) }
}

describe('durable team role samples', () => {
  it('reads cold saved records in both durable formats and retains samples after meter resets', () => {
    const tasks = [row('one', 100), row('two', 200, 'merged'), row('three', 300, 'discarded')]
    const expected = [{ role: 'engineering', taskTokens: [102, 202, 302] }]
    expect(readTeamRoleRecords(state(tasks))).toEqual(expected)
    expect(readTeamRoleRecords(state({ tasks, resets: { entry: 100 } }))).toEqual(expected)
  })
  it('keeps the latest twelve terminal samples per role, without counting token subsets twice', () => {
    const tasks = Array.from({ length: TEAM_LEARNED_RECENT_TASKS + 2 }, (_, i) => row(String(i), i))
    const latest = tasks
      .slice(-TEAM_LEARNED_RECENT_TASKS)
      .map((task) => task.usage.input + task.usage.output)
    expect(
      readTeamRoleRecords(
        state([...tasks.toReversed(), row('custom', 100, 'done', 'custom-role')]),
      ),
    ).toEqual([
      { role: 'engineering', taskTokens: latest },
      { role: 'custom-role', taskTokens: [102] },
    ])
  })
  it('does not learn from active, interrupted, uncertain or never-dispatched tasks, or duplicate snapshots', () => {
    const tasks = [
      ...['queued', 'starting', 'running', 'interrupted'].map((phase) => row(phase, 100, phase)),
      { ...row('unsent', 100), usage: { ...row('unsent', 100).usage, modelCalls: 0 } },
      { ...row('estimated', 100), usage: { ...row('estimated', 100).usage, estimated: true } },
      {
        ...row('pending', 100),
        claims: [{ ordinal: 1, atMs: 100, usage: row('pending', 100).usage, isSettled: false }],
      },
      row('same', 100),
      row('same', 200),
    ]
    expect(readTeamRoleRecords(state(tasks))).toEqual([{ role: 'engineering', taskTokens: [202] }])
  })
  it('uses empty history only for an actually empty store, and refuses corrupt saved records', () => {
    expect(readTeamRoleRecords(state(undefined))).toEqual([])
    expect(readTeamRoleRecords(state([]))).toEqual([])
    expect(() => readTeamRoleRecords(state({ tasks: 'broken', resets: {} }))).toThrow(
      UI_TEXT.teamBudgetUnavailable,
    )
    expect(() => readTeamRoleRecords(state([row('one', -1)]))).toThrow(
      UI_TEXT.teamBudgetUnavailable,
    )
  })
})
