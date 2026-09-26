import { describe, expect, it } from 'vitest'
import {
  applyGoalCommand,
  type GoalContext,
  goalInstructions,
  goalObjectiveProblem,
  type GoalRecord,
  goalResultText,
  runGoalTool,
  toSessionGoal,
  withTokensUsed,
} from '../../src/core/backends/modelapi/goals'
import {
  GOAL_OBJECTIVE_MAX_CHARS,
  GOAL_PROGRESS_REMINDER_STEPS,
  MODEL_TEXT,
} from '../../src/shared/constants'
import { goalDetails } from '../../src/webview/toolDetails'

const NOW = 1_790_358_439_700
const context: GoalContext = { sessionId: 's1', now: NOW, newId: () => 'abc' }

/** A goal as Muse Code's `create_goal` answered it (captured live 2026-09-25). */
const active: GoalRecord = {
  goal_id: 'goal-abc',
  objective: 'Say hello in one word',
  status: 'active',
  percent_complete: 0,
  current_work: null,
  next_work: null,
  token_budget: null,
  tokens_used: 0,
  created_at_ms: NOW,
  updated_at_ms: NOW,
  last_progress_at_ms: null,
}

/** One tool call on `active`, or on the goal given (`undefined`: none). */
function run(tool: string, args: unknown, ...goal: [] | [GoalRecord | undefined]) {
  return runGoalTool(tool, JSON.stringify(args), goal.length === 0 ? active : goal[0], context)
}

describe('the goal tools on the Model API backend (M45)', () => {
  it('create_goal answers in the exact shape Muse Code sends', () => {
    const result = run('create_goal', { objective: '  Say hello in one word ' }, undefined)
    expect(result.goal).toEqual(active)
    expect(JSON.parse(result.outcome.output)).toEqual({
      goal: {
        session_id: 's1',
        goal_id: 'goal-abc',
        objective: 'Say hello in one word',
        status: 'active',
        percent_complete: 0,
        current_work: null,
        next_work: null,
        token_budget: null,
        tokens_used: 0,
        created_at_ms: NOW,
        updated_at_ms: NOW,
        last_progress_at_ms: null,
      },
    })
    expect(result.outcome.visibleOutput).toBe(result.outcome.output)
    // So the M43 row reads it as it reads Muse Code's.
    expect(goalDetails(result.outcome.visibleOutput)).toMatchObject({
      objective: 'Say hello in one word',
      status: 'active',
      percentComplete: 0,
    })
  })

  it('create_goal refuses over an unfinished goal and replaces a finished one', () => {
    expect(run('create_goal', { objective: 'Other' }).outcome.failureReason).toBe(
      MODEL_TEXT.goalUnfinishedExists,
    )
    const paused = { ...active, status: 'paused' }
    const refused = run('create_goal', { objective: 'Other' }, paused)
    expect(refused.outcome.failureReason).toBe(MODEL_TEXT.goalPausedExists)
    expect(refused.goal).toBe(paused)
    const done = { ...active, status: 'complete', percent_complete: 100 }
    expect(run('create_goal', { objective: 'Next' }, done).goal).toMatchObject({
      objective: 'Next',
      status: 'active',
      percent_complete: 0,
    })
  })

  it('create_goal checks the objective and the budget', () => {
    expect(run('create_goal', { objective: '  ' }, undefined).outcome.failureReason).toBe(
      MODEL_TEXT.goalEmptyObjective,
    )
    expect(run('create_goal', {}, undefined).outcome.failureReason).toBe(
      MODEL_TEXT.goalEmptyObjective,
    )
    const long = 'x'.repeat(GOAL_OBJECTIVE_MAX_CHARS + 1)
    expect(run('create_goal', { objective: long }, undefined).outcome.failureReason).toBe(
      `${MODEL_TEXT.goalObjectiveTooLong} ${String(GOAL_OBJECTIVE_MAX_CHARS)}`,
    )
    for (const budget of [0, -5, 1.5]) {
      expect(
        run('create_goal', { objective: 'x', token_budget: budget }, undefined).outcome
          .failureReason,
      ).toBe(MODEL_TEXT.goalBadBudget)
    }
    expect(
      run('create_goal', { objective: 'x', token_budget: 5000 }, undefined).goal,
    ).toMatchObject({ token_budget: 5000 })
    expect(runGoalTool('create_goal', 'not json', undefined, context).outcome.failureReason).toBe(
      MODEL_TEXT.goalEmptyObjective,
    )
  })

  it('get_goal answers the goal, or {"goal": null} without one, and changes nothing', () => {
    const got = run('get_goal', {})
    expect(got.goal).toBe(active)
    expect(JSON.parse(got.outcome.output)).toMatchObject({ goal: { objective: active.objective } })
    const none = run('get_goal', {}, undefined)
    expect(none.outcome.output).toBe('{"goal":null}')
    expect(none.goal).toBeUndefined()
  })

  it('update_goal closes an active goal: complete is 100 percent, blocked keeps its progress', () => {
    const halfway = { ...active, percent_complete: 40 }
    expect(run('update_goal', { status: 'complete' }, halfway).goal).toMatchObject({
      status: 'complete',
      percent_complete: 100,
    })
    expect(run('update_goal', { status: 'blocked' }, halfway).goal).toMatchObject({
      status: 'blocked',
      percent_complete: 40,
    })
    expect(run('update_goal', { status: 'paused' }).outcome.failureReason).toBe(
      MODEL_TEXT.goalBadStatus,
    )
    for (const goal of [undefined, { ...active, status: 'paused' }]) {
      const refused = run('update_goal', { status: 'complete' }, goal)
      expect(refused.outcome.failureReason).toBe(MODEL_TEXT.goalNoActive)
      expect(refused.goal).toBe(goal)
    }
  })

  it('report_progress records the work, and 100 percent completes the goal', () => {
    const progress = run('report_progress', {
      current_work: 'Saying hello',
      next_work: 'Mark complete',
      percent_complete: 50,
    })
    expect(progress.goal).toMatchObject({
      status: 'active',
      percent_complete: 50,
      current_work: 'Saying hello',
      next_work: 'Mark complete',
      last_progress_at_ms: NOW,
    })
    expect(
      run('report_progress', { current_work: 'a', next_work: 'b', percent_complete: 100 }).goal,
    ).toMatchObject({ status: 'complete', percent_complete: 100 })
    for (const percent of [-1, 101, 12.5]) {
      expect(
        run('report_progress', { current_work: 'a', next_work: 'b', percent_complete: percent })
          .outcome.failureReason,
      ).toBe(MODEL_TEXT.goalBadPercent)
    }
    expect(
      run('report_progress', { current_work: ' ', next_work: 'b', percent_complete: 5 }).outcome
        .failureReason,
    ).toBe(MODEL_TEXT.goalEmptyWork)
    expect(
      run('report_progress', { current_work: 'a', next_work: 'b', percent_complete: 5 }, undefined)
        .outcome.failureReason,
    ).toBe(MODEL_TEXT.goalNoActive)
  })

  it('writes the result the row reads, with the session id first', () => {
    expect(goalResultText('s9', active)).toMatch(/^\{"goal":\{"session_id":"s9","goal_id":/)
  })
})

describe('the user goal verbs on the Model API backend (M45)', () => {
  const set = { verb: 'set', objective: 'Ship the parser' } as const

  it('set makes a new active goal whatever was there', () => {
    for (const before of [undefined, active, { ...active, status: 'complete' }]) {
      expect(applyGoalCommand(before, set, context)).toEqual({
        goal: { ...active, objective: 'Ship the parser' },
      })
    }
  })

  it('refuses what MSP refuses: no goal, or the wrong state', () => {
    for (const verb of ['pause', 'resume', 'clear'] as const) {
      expect(applyGoalCommand(undefined, { verb }, context)).toBe('noGoal')
    }
    expect(applyGoalCommand(undefined, { verb: 'edit', objective: 'x' }, context)).toBe('noGoal')
    const done = { ...active, status: 'complete' }
    expect(applyGoalCommand(done, { verb: 'pause' }, context)).toBe('wrongState')
    expect(applyGoalCommand(done, { verb: 'resume' }, context)).toBe('wrongState')
    expect(applyGoalCommand(done, { verb: 'edit', objective: 'x' }, context)).toBe('wrongState')
    expect(applyGoalCommand(active, { verb: 'resume' }, context)).toBe('wrongState')
    expect(applyGoalCommand({ ...active, status: 'paused' }, { verb: 'pause' }, context)).toBe(
      'wrongState',
    )
  })

  it('pauses, resumes, edits (keeping the status) and clears', () => {
    const paused = applyGoalCommand(active, { verb: 'pause' }, context)
    expect(paused).toMatchObject({ goal: { status: 'paused' } })
    const pausedGoal = typeof paused === 'string' ? undefined : paused.goal
    expect(applyGoalCommand(pausedGoal, { verb: 'resume' }, context)).toMatchObject({
      goal: { status: 'active' },
    })
    expect(
      applyGoalCommand(pausedGoal, { verb: 'edit', objective: ' New ' }, context),
    ).toMatchObject({ goal: { status: 'paused', objective: 'New' } })
    expect(applyGoalCommand(active, { verb: 'clear' }, context)).toEqual({ goal: undefined })
    expect(applyGoalCommand({ ...active, status: 'complete' }, { verb: 'clear' }, context)).toEqual(
      { goal: undefined },
    )
  })

  it('checks a set or edit objective before anything changes', () => {
    expect(goalObjectiveProblem({ verb: 'set', objective: ' ' })).toBe('empty')
    expect(
      goalObjectiveProblem({ verb: 'edit', objective: 'x'.repeat(GOAL_OBJECTIVE_MAX_CHARS + 1) }),
    ).toBe('tooLong')
    expect(goalObjectiveProblem({ verb: 'set', objective: '😀'.repeat(2001) })).toBeUndefined()
    expect(goalObjectiveProblem({ verb: 'set', objective: '👨‍👩‍👧‍👦'.repeat(2001) })).toBeUndefined()
    expect(
      goalObjectiveProblem({ verb: 'set', objective: '😀'.repeat(GOAL_OBJECTIVE_MAX_CHARS + 1) }),
    ).toBe('tooLong')
    expect(goalObjectiveProblem({ verb: 'edit', objective: 'fine' })).toBeUndefined()
    expect(goalObjectiveProblem({ verb: 'pause' })).toBeUndefined()
  })
})

describe('the goal loop on the Model API backend (M45)', () => {
  it('counts tokens against a budget, and a spent budget stops the goal', () => {
    const budgeted = { ...active, token_budget: 1000, tokens_used: 400 }
    expect(withTokensUsed(budgeted, 500, NOW + 1)).toMatchObject({
      tokens_used: 900,
      status: 'active',
    })
    expect(withTokensUsed(budgeted, 600, NOW + 1)).toMatchObject({
      tokens_used: 1000,
      status: 'budget_limited',
      updated_at_ms: NOW + 1,
    })
    expect(withTokensUsed(active, 10_000_000, NOW)).toMatchObject({ status: 'active' })
  })

  it('shows the panel the MSP goal block', () => {
    expect(toSessionGoal(active)).toEqual({
      objective: 'Say hello in one word',
      status: 'active',
      percentComplete: 0,
    })
    expect(toSessionGoal({ ...active, current_work: 'a', next_work: 'b' })).toMatchObject({
      currentWork: 'a',
      nextWork: 'b',
    })
  })

  it('pins the goal while it is active, and adds the step probe after ten quiet calls', () => {
    expect(goalInstructions(undefined, 0)).toBeUndefined()
    expect(goalInstructions({ ...active, status: 'paused' }, 0)).toBeUndefined()
    const pinned = goalInstructions(
      { ...active, current_work: 'Tests', next_work: 'Fix', token_budget: 9, tokens_used: 3 },
      GOAL_PROGRESS_REMINDER_STEPS - 1,
    )
    expect(pinned).toContain('# Session goal')
    expect(pinned).toContain('- Objective: Say hello in one word')
    expect(pinned).toContain('- Current work: Tests')
    expect(pinned).toContain('- Tokens used: 3 of a budget of 9')
    expect(pinned).not.toContain('Progress has not been reported')
    expect(goalInstructions(active, GOAL_PROGRESS_REMINDER_STEPS)).toContain(
      `Progress has not been reported in the last ${String(GOAL_PROGRESS_REMINDER_STEPS)} model calls.`,
    )
  })
})
