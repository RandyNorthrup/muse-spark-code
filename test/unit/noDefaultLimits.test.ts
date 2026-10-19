import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import { QUESTION_DEFER_DEFAULT_SECONDS } from '../../src/shared/constants'
import { questionDeferSeconds } from '../../src/shared/questionDeadline'

// NOLIMITSALL (PLAN.md D121): every limit setting defaults to no limit; the
// person sets their own. 0 is none, as `hooksMaxRunningCommands = 0` and
// `modelApiSessionBudgetUsd = 0` already do.
describe('no default limits: questions deferral', () => {
  it('defaults to never deferring until the person sets a delay', () => {
    expect(QUESTION_DEFER_DEFAULT_SECONDS).toBe(0)
    expect(
      manifest.contributes.configuration.properties['museSpark.questions.deferAfterSeconds']
        .default,
    ).toBe(0)
  })

  it('waits indefinitely with nothing set and still applies a person-set delay', () => {
    expect(questionDeferSeconds()).toBe(0)
    expect(questionDeferSeconds(0)).toBe(0)
    expect(questionDeferSeconds(60)).toBe(60)
    expect(questionDeferSeconds(5)).toBe(10)
  })
})
