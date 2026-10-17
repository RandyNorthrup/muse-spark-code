// The verify loop's ledger (M68; the Codex review of PR #54, third round):
// runs recorded against the state they saw, a round's verdict from the runs
// still on the latest state, the fix loop's count, and one reset.

import { describe, expect, it, vi } from 'vitest'
import { type CheckScope, VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { WorkspaceEdits } from '../../src/core/verify/workspaceEdits'
import { authorizeThenGuard } from '../../src/core/backends/modelapi/verifyLoop'
import { CHECK_FIX_MAX_ROUNDS, type CheckOutcome } from '../../src/shared/constants'

const A = { relative: 'src/a.ts', absolute: '/ws/src/a.ts' }
const B = { relative: 'src/b.ts', absolute: '/ws/src/b.ts' }

/** A check that ran over `scope` on the state as it is now. */
function run(ledger: VerifyLedger, name: string, outcome: CheckOutcome, scope: CheckScope): void {
  ledger.record(outcome, ledger.snapshot(name, scope))
}

/** `rounds` failing verdicts in a row; whether the last one stopped the checks. */
function hasStoppedAfter(ledger: VerifyLedger, rounds: number): boolean {
  let isStopping = false
  for (let round = 0; round < rounds; round += 1) {
    run(ledger, 'lint', 'failed', 'project')
    isStopping = ledger.judgeRound()
  }
  return isStopping
}

describe('VerifyLedger', () => {
  it('invalidates grants and runs before a workspace write, across a user-message reset', () => {
    const ledger = new VerifyLedger()
    const script = { relative: 'scripts/check.js', absolute: '/ws/scripts/check.js' }
    run(ledger, 'test', 'passed', 'project')
    const complete = ledger.beginEdit(script, [script.relative])
    expect(ledger.changesWhatRuns('node scripts/check')).toBe(true)
    expect(ledger.hasCurrentRun('test', 'project')).toBe(false)
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('node scripts/check')).toBe(true)
    run(ledger, 'test', 'passed', 'project')
    expect(ledger.hasCurrentRun('test', 'project')).toBe(false)
    complete()
    expect(ledger.hasCurrentRun('test', 'project')).toBe(false)
    expect(ledger.changesWhatRuns('node scripts/check')).toBe(true)
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('node scripts/check')).toBe(false)
    run(ledger, 'test', 'passed', 'project')
    expect(ledger.hasCurrentRun('test', 'project')).toBe(true)
  })

  it('keeps unrelated file runs current and a config blocked until every pending write ends', () => {
    const ledger = new VerifyLedger()
    const config = { relative: 'eslint.config.js', absolute: '/ws/eslint.config.js' }
    run(ledger, 'lint', 'passed', [A])
    const first = ledger.beginEdit(config, [config.relative])
    const second = ledger.beginEdit(config, [config.relative])
    ledger.resetForMessage()
    expect(ledger.codeFile).toBe(config.relative)
    run(ledger, 'lint', 'passed', [A])
    expect(ledger.hasCurrentRun('lint', [A])).toBe(true)
    first()
    ledger.resetForMessage()
    expect(ledger.codeFile).toBe(config.relative)
    second()
    ledger.resetForMessage()
    expect(ledger.codeFile).toBeUndefined()
  })

  it('shares pending writes with existing and newly live sessions, and releases disposed ones', () => {
    const workspace = new WorkspaceEdits()
    const parent = new VerifyLedger()
    const child = new VerifyLedger()
    const sibling = new VerifyLedger()
    workspace.add(parent)
    workspace.add(child)
    const complete = workspace.beginEdit(A, [A.relative])
    workspace.add(sibling)
    for (const ledger of [parent, child, sibling]) {
      ledger.resetForMessage()
      expect(ledger.changesWhatRuns('node src/a.ts')).toBe(true)
      run(ledger, 'lint', 'passed', [A])
      expect(ledger.hasCurrentRun('lint', [A])).toBe(false)
    }
    workspace.delete(child)
    child.resetForMessage()
    expect(child.changesWhatRuns('node src/a.ts')).toBe(false)
    complete()
    for (const ledger of [parent, sibling]) {
      expect(ledger.hasCurrentRun('lint', [A])).toBe(false)
      ledger.resetForMessage()
      expect(ledger.changesWhatRuns('node src/a.ts')).toBe(false)
    }
  })

  it('judges a round only by the runs on the latest state of what they covered', () => {
    const ledger = new VerifyLedger()
    // A failing whole-project run, then an edit, then a passing run: passed.
    run(ledger, 'lint', 'failed', 'project')
    ledger.noteEdit(A, [A.relative])
    run(ledger, 'lint', 'passed', [A])
    expect(ledger.judgeRound()).toBe(false)
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
    expect(ledger.isStopped).toBe(false)
  })

  it('keeps a run on files an edit did not touch, and drops one on a file it did', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative])
    ledger.noteEdit(B, [B.relative])
    run(ledger, 'lint', 'passed', [A])
    run(ledger, 'types', 'passed', [B])
    ledger.noteEdit(B, [B.relative])
    expect(ledger.hasCurrentRun('lint', [A])).toBe(true)
    expect(ledger.hasCurrentRun('types', [B])).toBe(false)
    // A run over one file does not answer for another, nor for the project.
    expect(ledger.hasCurrentRun('lint', [A, B])).toBe(false)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    // A whole-project run answers for any scope until the next edit.
    run(ledger, 'test', 'passed', 'project')
    expect(ledger.hasCurrentRun('test', [A, B])).toBe(true)
    ledger.noteEdit(A, [A.relative])
    expect(ledger.hasCurrentRun('test', [B])).toBe(false)
  })

  it('counts failing verdicts in a row, resets on a passing one, and stops at the limit', () => {
    const ledger = new VerifyLedger()
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
    run(ledger, 'lint', 'passed', 'project')
    expect(ledger.judgeRound()).toBe(false)
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
    expect(hasStoppedAfter(ledger, 1)).toBe(true)
    expect(ledger.isStopped).toBe(true)
    // Once stopped, a further failing verdict does not announce it again.
    expect(hasStoppedAfter(ledger, 1)).toBe(false)
  })

  it('judges each run once, and leaves the count alone when nothing ran', () => {
    const ledger = new VerifyLedger()
    run(ledger, 'lint', 'failed', 'project')
    run(ledger, 'lint', 'notRun', 'project')
    run(ledger, 'lint', 'cancelled', 'project')
    expect(ledger.judgeRound()).toBe(false)
    // Nothing new ran: the next rounds judge nothing, twice.
    expect(ledger.judgeRound()).toBe(false)
    expect(ledger.judgeRound()).toBe(false)
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(true)
  })

  it('gives no verdict when every run since the last one went stale', () => {
    const ledger = new VerifyLedger()
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
    // A failure an edit has since overtaken says nothing about this round.
    run(ledger, 'lint', 'failed', 'project')
    ledger.noteEdit(A, [A.relative])
    expect(ledger.judgeRound()).toBe(false)
    expect(hasStoppedAfter(ledger, 1)).toBe(true)
  })

  it('records nothing for a check that did not run or was stopped', () => {
    const ledger = new VerifyLedger()
    run(ledger, 'lint', 'notRun', 'project')
    run(ledger, 'test', 'cancelled', 'project')
    // Neither answers for the check, nor moves the fix loop.
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    expect(ledger.hasCurrentRun('test', 'project')).toBe(false)
    expect(ledger.judgeRound()).toBe(false)
    expect(hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
    expect(hasStoppedAfter(ledger, 1)).toBe(true)
  })

  it('forgets everything on the user’s message, and a stopped turn’s round on a new turn', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative, 'package.json'])
    ledger.reject('lint')
    hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS)
    expect(ledger.changesWhatRuns('npm run lint')).toBe(true)
    ledger.resetForMessage()
    expect(ledger.isStopped).toBe(false)
    expect(ledger.isRejected('lint')).toBe(false)
    expect(ledger.editedFiles()).toEqual([])
    expect(ledger.takeRoundEdits()).toEqual([])
    expect(ledger.changesWhatRuns('npm run lint')).toBe(false)
    expect(ledger.codeFile).toBeUndefined()
    // A new turn drops the round a stopped turn left, and its unjudged runs.
    ledger.noteEdit(B, [B.relative])
    run(ledger, 'lint', 'failed', [B])
    ledger.beginTurn()
    expect(ledger.takeRoundEdits()).toEqual([])
    expect(ledger.editedFiles()).toEqual([B])
    expect(ledger.judgeRound()).toBe(false)
  })

  // The review of e4b035a3: a steer is user input, but what the model wrote stays.
  it('starts the fix loop, rejections and runs afresh on a steer, and keeps what was written', () => {
    const ledger = new VerifyLedger()
    const config = { relative: 'eslint.config.js', absolute: '/ws/eslint.config.js' }
    ledger.noteEdit(config, [config.relative, 'package.json'])
    ledger.reject('lint')
    hasStoppedAfter(ledger, CHECK_FIX_MAX_ROUNDS)
    ledger.resetForSteer()
    expect(ledger.isStopped).toBe(false)
    expect(ledger.isRejected('lint')).toBe(false)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    expect(ledger.changesWhatRuns('npm run lint')).toBe(true)
    expect(ledger.codeFile).toBe('eslint.config.js')
    expect(ledger.editedFiles()).toEqual([config])
  })

  // The review of e4b035a3: a verdict passes only when no current run failed.
  it('keeps counting a failure no edit has touched, until a later run of that check passes', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative])
    ledger.noteEdit(B, [B.relative])
    run(ledger, 'lint', 'failed', [A])
    expect(ledger.judgeRound()).toBe(false)
    // B passes, but A's failure is still on A's latest state.
    run(ledger, 'lint', 'passed', [B])
    expect(ledger.judgeRound()).toBe(false)
    run(ledger, 'lint', 'passed', [B])
    expect(ledger.judgeRound()).toBe(true)
    // A later run of the same check over A that passes supersedes the failure.
    const again = new VerifyLedger()
    again.noteEdit(A, [A.relative])
    run(again, 'lint', 'failed', [A])
    again.judgeRound()
    run(again, 'lint', 'passed', [A])
    again.judgeRound()
    expect(hasStoppedAfter(again, CHECK_FIX_MAX_ROUNDS - 1)).toBe(false)
  })

  // The review of e4b035a3: a subagent's edit advances its parent's state.
  it('takes an edit made by someone it answers for as a new state of that file', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative])
    run(ledger, 'lint', 'passed', [A])
    run(ledger, 'test', 'passed', 'project')
    ledger.noteOutsideEdit(A, [A.relative])
    expect(ledger.hasCurrentRun('lint', [A])).toBe(false)
    expect(ledger.hasCurrentRun('test', 'project')).toBe(false)
    // Not a file this session wrote: run_checks does not take it by default.
    ledger.noteOutsideEdit(B, [B.relative])
    expect(ledger.editedFiles()).toEqual([A])
  })

  // Grok's review: a run is recorded against the state it started on.
  it('leaves behind a run that an edit overtook while it ran', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative])
    const startedOn = ledger.snapshot('lint', [A])
    // A subagent edits the file while the check runs.
    ledger.noteOutsideEdit(A, [A.relative])
    ledger.record('passed', startedOn)
    expect(ledger.hasCurrentRun('lint', [A])).toBe(false)
    expect(ledger.judgeRound()).toBe(false)
  })

  // Grok's review: what a subagent writes decides for the parent too.
  it('takes what someone it answers for wrote as deciding what runs', () => {
    const ledger = new VerifyLedger()
    const manifest = { relative: 'package.json', absolute: '/ws/package.json' }
    ledger.noteOutsideEdit(manifest, [manifest.relative])
    expect(ledger.changesWhatRuns('npm run lint')).toBe(true)
    expect(ledger.codeFile).toBe('package.json')
    expect(ledger.editedFiles()).toEqual([])
  })

  it('names the first file written that the editor’s tools run as code', () => {
    const ledger = new VerifyLedger()
    ledger.noteEdit(A, [A.relative])
    expect(ledger.codeFile).toBeUndefined()
    const config = { relative: 'eslint.config.js', absolute: '/ws/eslint.config.js' }
    ledger.noteEdit(config, [config.relative])
    ledger.noteEdit({ relative: 'package.json', absolute: '/ws/package.json' }, ['package.json'])
    expect(ledger.codeFile).toBe('eslint.config.js')
    expect(ledger.takeRoundEdits().map((file) => file.relative)).toEqual([
      'src/a.ts',
      'eslint.config.js',
      'package.json',
    ])
  })
})

// Grok's review of PR #54's fourth round: a rule that answered may lapse
// while the command waits on its guard; the command is authorized again.
describe('authorizeThenGuard', () => {
  it('authorizes again, and guards again, when the rule lapsed during the guard', async () => {
    let isLapsed = false
    const authorize = vi.fn(() => Promise.resolve(undefined))
    const guard = vi.fn(() => {
      // A subagent edits the script while the guard reads the file.
      isLapsed = true
      return Promise.resolve(true)
    })
    expect(await authorizeThenGuard({ isRuleLapsed: () => isLapsed, authorize, guard })).toBe(
      undefined,
    )
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(guard).toHaveBeenCalledTimes(2)
  })

  it('refuses when the second authorization refuses, and runs once when nothing lapsed', async () => {
    let isLapsed = false
    let asked = 0
    const refusal = await authorizeThenGuard({
      isRuleLapsed: () => isLapsed,
      authorize: () => {
        asked += 1
        return Promise.resolve(asked === 2 ? { skip: 'rejected' as const } : undefined)
      },
      guard: () => {
        isLapsed = true
        return Promise.resolve(true)
      },
    })
    expect(refusal).toEqual({ skip: 'rejected' })
    const once = vi.fn(() => Promise.resolve(undefined))
    expect(await authorizeThenGuard({ isRuleLapsed: () => false, authorize: once })).toBe(undefined)
    expect(once).toHaveBeenCalledTimes(1)
    // A rule already lapsed at the start is not asked about twice.
    const lapsed = vi.fn(() => Promise.resolve(undefined))
    await authorizeThenGuard({ isRuleLapsed: () => true, authorize: lapsed })
    expect(lapsed).toHaveBeenCalledTimes(1)
    // A guard that fails refuses as "changed".
    expect(
      await authorizeThenGuard({
        isRuleLapsed: () => false,
        authorize: once,
        guard: () => Promise.resolve(false),
      }),
    ).toEqual({ skip: 'changed' })
  })
})
