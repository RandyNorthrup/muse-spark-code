import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConflictPredictor,
  plannedConflicts,
  type ConflictPredictionDeps,
  type PredictionTask,
  type PredictedConflict,
} from '../../src/core/team/conflictPredict'
import { mergeChangelog } from '../../src/core/team/merge/changelog'
import { mergeJsonTable } from '../../src/core/team/merge/jsonTable'
import { SharedFiles } from '../../src/core/team/sharedFiles'
import { expandWriteSet } from '../../src/core/team/writeSets'
import { TEAM_DIFF_POLL_MS } from '../../src/shared/constants'

afterEach(() => {
  vi.useRealTimers()
})

function fixture() {
  const tasks: PredictionTask[] = [
    { taskId: 'a', attempt: 1, files: ['src/a.ts', 'l10n/ui.json', 'CHANGELOG.md'] },
    { taskId: 'b', attempt: 1, files: ['src/a.ts', 'l10n/ui.json', 'CHANGELOG.md'] },
  ]
  const events: PredictedConflict[] = []
  const errors: unknown[] = []
  let hasConflict = true
  const changelog = '# Changes\n\n## [Unreleased]\n\n### Added\n\n- Base.\n'
  const merge = vi.fn<ConflictPredictionDeps['merge']>((path, _task, other) => {
    if (path === 'l10n/ui.json') return Promise.resolve(mergeJsonTable('{}', '{"a":1}', '{"b":2}'))
    if (path === 'CHANGELOG.md')
      return Promise.resolve(mergeChangelog(changelog, changelog + '- A.\n', changelog + '- B.\n'))
    return Promise.resolve({
      kind: hasConflict && (path === 'src/a.ts' || other === undefined) ? 'conflict' : 'merged',
    })
  })
  const deps: ConflictPredictionDeps = {
    readTasks: () => Promise.resolve(tasks),
    integrationFiles: () => Promise.resolve(['src/a.ts']),
    merge,
    onConflict: (event) => {
      events.push(event)
    },
    onError: (error) => {
      errors.push(error)
    },
  }
  return {
    predictor: new ConflictPredictor(deps),
    deps,
    tasks,
    events,
    errors,
    clean: () => {
      hasConflict = false
    },
    conflict: () => {
      hasConflict = true
    },
  }
}

describe('team conflict prediction', () => {
  it('uses landing merges for every common file and predicts integration changes, notifying once', async () => {
    const state = fixture()
    await state.predictor.poll()
    expect(state.events).toHaveLength(3)
    expect(state.events.map((event) => event.otherTaskId)).toEqual([
      'b',
      'integration',
      'integration',
    ])
    expect(state.events.every((event) => event.paths[0] === 'src/a.ts')).toBe(true)
    expect(state.deps.merge).toHaveBeenCalledWith('l10n/ui.json', state.tasks[0], state.tasks[1])
    expect(state.deps.merge).toHaveBeenCalledWith('CHANGELOG.md', state.tasks[0], state.tasks[1])
    await state.predictor.poll()
    expect(state.events).toHaveLength(3)
    state.clean()
    await state.predictor.poll()
    state.conflict()
    await state.predictor.poll()
    expect(state.events).toHaveLength(6)
  })

  it('does no setup traffic until started and polls within one interval', async () => {
    vi.useFakeTimers()
    const state = fixture()
    await vi.advanceTimersByTimeAsync(TEAM_DIFF_POLL_MS * 2)
    expect(state.events).toEqual([])
    state.predictor.start()
    state.predictor.start()
    await vi.advanceTimersByTimeAsync(TEAM_DIFF_POLL_MS)
    expect(state.events).toHaveLength(3)
    state.predictor.stop()
    await vi.advanceTimersByTimeAsync(TEAM_DIFF_POLL_MS)
    expect(state.events).toHaveLength(3)
  })

  it('identifies both attempts and notifies symmetrically when either task is reassigned', async () => {
    const state = fixture()
    await state.predictor.poll()
    expect(state.events[0]).toMatchObject({
      taskId: 'a',
      attempt: 1,
      otherTaskId: 'b',
      otherAttempt: 1,
    })
    state.tasks[1] = { ...state.tasks[1]!, attempt: 2 }
    await state.predictor.poll()
    expect(state.events.filter((event) => event.otherTaskId === 'b')).toEqual([
      { taskId: 'a', attempt: 1, otherTaskId: 'b', otherAttempt: 1, paths: ['src/a.ts'] },
      { taskId: 'a', attempt: 1, otherTaskId: 'b', otherAttempt: 2, paths: ['src/a.ts'] },
    ])
    state.tasks[0] = { ...state.tasks[0]!, attempt: 2 }
    await state.predictor.poll()
    expect(state.events.filter((event) => event.otherTaskId === 'b')).toHaveLength(3)
    expect(state.events.findLast((event) => event.otherTaskId === 'b')).toMatchObject({
      attempt: 2,
      otherAttempt: 2,
    })
    expect(
      state.events
        .filter((event) => event.otherTaskId === 'integration')
        .every((event) => event.otherAttempt === undefined),
    ).toBe(true)
  })

  it('starts fresh polling after restart and prevents an old finalizer from clearing new work', async () => {
    vi.useFakeTimers()
    const state = fixture()
    const old = Promise.withResolvers<readonly PredictionTask[]>()
    const fresh = Promise.withResolvers<readonly PredictionTask[]>()
    const reads = vi
      .fn<ConflictPredictionDeps['readTasks']>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockResolvedValue(state.tasks)
    const predictor = new ConflictPredictor({ ...state.deps, readTasks: reads })
    const oldPoll = predictor.poll()
    predictor.stop()
    predictor.start()
    const newPoll = predictor.poll()
    expect(reads).toHaveBeenCalledTimes(2)
    old.resolve(state.tasks)
    await oldPoll
    expect(state.events).toEqual([])
    expect(state.deps.merge).not.toHaveBeenCalled()
    const coalesced = predictor.poll()
    expect(coalesced).toBe(newPoll)
    fresh.resolve(state.tasks)
    await Promise.all([newPoll, coalesced])
    expect(reads).toHaveBeenCalledTimes(3)
    expect(state.events).toHaveLength(3)
    predictor.stop()
  })

  it('publishes restarted results while an old read remains unresolved', async () => {
    vi.useFakeTimers()
    const state = fixture()
    const old = Promise.withResolvers<readonly PredictionTask[]>()
    const reads = vi
      .fn<ConflictPredictionDeps['readTasks']>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(state.tasks)
    const predictor = new ConflictPredictor({ ...state.deps, readTasks: reads })
    predictor.start()
    const oldPoll = predictor.poll()
    predictor.stop()
    predictor.start()
    await vi.advanceTimersByTimeAsync(TEAM_DIFF_POLL_MS)
    expect(reads).toHaveBeenCalledTimes(2)
    expect(state.events).toHaveLength(3)
    old.resolve([])
    await oldPoll
    await predictor.poll()
    expect(state.events).toHaveLength(3)
    predictor.stop()
  })

  it('suppresses late results after stop and reports failed diff reads', async () => {
    vi.useFakeTimers()
    const state = fixture()
    const { promise: pending, resolve } = Promise.withResolvers<readonly PredictionTask[]>()
    const late = new ConflictPredictor({ ...state.deps, readTasks: () => pending })
    const poll = late.poll()
    late.stop()
    resolve(state.tasks)
    await poll
    expect(state.events).toEqual([])
    const fault = new Error('diff failed')
    const failing = new ConflictPredictor({ ...state.deps, readTasks: () => Promise.reject(fault) })
    failing.start()
    await vi.advanceTimersByTimeAsync(TEAM_DIFF_POLL_MS)
    expect(state.errors).toEqual([fault])
    failing.stop()
  })

  it('warns about planned ordinary-file overlaps at submission', () => {
    const conflicts = plannedConflicts(
      [
        { taskId: 'a', set: expandWriteSet(['src/a.ts'], []) },
        { taskId: 'b', set: expandWriteSet(['src/a.ts'], []) },
        { taskId: 'json', set: expandWriteSet(['l10n/*.json'], []) },
      ],
      new SharedFiles(),
    )
    expect(conflicts).toEqual([
      { taskId: 'a', attempt: 1, otherTaskId: 'b', otherAttempt: 1, paths: ['src/a.ts'] },
    ])
  })
})
