// D119 catch burn-down: every poll failure is posted to the owner's
// record. The sweep fails for real below.
import { describe, expect, it } from 'vitest'
import {
  ConflictPredictor,
  type ConflictPredictionDeps,
  type PredictedConflict,
} from '../../src/core/team/conflictPredict'

function deps(overrides: Partial<ConflictPredictionDeps>): ConflictPredictionDeps {
  return {
    readTasks: () => Promise.resolve([]),
    integrationFiles: () => Promise.resolve([]),
    merge: () => Promise.resolve({ kind: 'merged' }),
    onConflict: () => undefined,
    report: () => undefined,
    ...overrides,
  }
}

describe('conflict prediction failures', () => {
  it('posts a poll failure to the owner’s record', async () => {
    const failure = new Error('task snapshot unavailable')
    const reported: unknown[] = []
    const predictor = new ConflictPredictor(
      deps({
        readTasks: () => Promise.reject(failure),
        report: (error) => {
          reported.push(error)
        },
      }),
    )
    await predictor.pollGuarded()
    expect(reported).toEqual([failure])
  })

  it('still reports a predicted conflict', async () => {
    const conflicts: PredictedConflict[] = []
    const predictor = new ConflictPredictor(
      deps({
        readTasks: () =>
          Promise.resolve([
            { taskId: 'a', attempt: 1, files: ['f.txt'] },
            { taskId: 'b', attempt: 1, files: ['f.txt'] },
          ]),
        merge: () => Promise.resolve({ kind: 'conflict' }),
        onConflict: (conflict) => {
          conflicts.push(conflict)
        },
      }),
    )
    await predictor.pollGuarded()
    expect(conflicts).toEqual([
      { taskId: 'a', attempt: 1, otherTaskId: 'b', otherAttempt: 1, paths: ['f.txt'] },
    ])
  })
})
