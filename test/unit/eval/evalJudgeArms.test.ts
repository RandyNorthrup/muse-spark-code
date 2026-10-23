// M125 lane V (D107): the judge arms' frozen options. Each arm builds
// through the real frozen path (esbuild plus the restricted child) and
// returns its isolation option; the parent's adapt to the pin is proven
// by the wiring run, where the isolated decision fires and the rest do
// not. Baselines, mapping and membership pinned beside the options.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { armRepoRoot, buildArmBundle, executeArmBundle } from '../../../src/core/eval/armSources'
import {
  JUDGE_ARMED_DECISIONS,
  JUDGE_EVAL_ARMS,
  judgeArmBaseline,
  judgeArmDecision,
} from '../../../src/core/eval/mechanisms'

const ARM_PROGRAM = 'src/core/eval/armDefinitions.ts'

const optionsOf = (name: string): unknown =>
  executeArmBundle(buildArmBundle(path.join(armRepoRoot(), ARM_PROGRAM), name))

describe('judge arms', () => {
  it('isolates one decision per arm against the all-off baseline', () => {
    expect(optionsOf('judge-off')).toEqual({ name: 'judge-off', fastIsolated: 'none' })
    expect(optionsOf('judge-triage')).toEqual({
      name: 'judge-triage',
      fastIsolated: 'triage.needFull',
      observationPacking: true,
    })
    expect(optionsOf('judge-pack-off')).toEqual({
      name: 'judge-pack-off',
      fastIsolated: 'none',
      observationPacking: true,
    })
    expect(optionsOf('judge-loop')).toEqual({ name: 'judge-loop', fastIsolated: 'loop.stuck' })
    expect(optionsOf('judge-effort')).toEqual({
      name: 'judge-effort',
      fastIsolated: 'effort.lower',
    })
    expect(optionsOf('judge-failure')).toEqual({
      name: 'judge-failure',
      fastIsolated: 'failure.unmentioned',
    })
    expect(optionsOf('judge-done')).toEqual({
      name: 'judge-done',
      fastIsolated: 'done.unbacked',
    })
  })

  it('carries evaluated compaction on keep’s pair alone', () => {
    expect(optionsOf('judge-keep-off')).toEqual({
      name: 'judge-keep-off',
      fastIsolated: 'none',
      autoCompaction: true,
      autoCompactionEvaluated: true,
      evaluationAdmission: true,
    })
    expect(optionsOf('judge-context')).toEqual({
      name: 'judge-context',
      fastIsolated: 'context.include',
      autoCompaction: true,
      autoCompactionEvaluated: true,
      evaluationAdmission: true,
    })
  })

  it('maps arms to decisions and baselines', () => {
    expect(JUDGE_ARMED_DECISIONS).toHaveLength(6)
    expect(JUDGE_EVAL_ARMS.map((arm) => arm.name)).toEqual([
      'judge-off',
      'judge-keep-off',
      'judge-pack-off',
      'judge-triage',
      'judge-context',
      'judge-loop',
      'judge-effort',
      'judge-failure',
      'judge-done',
    ])
    expect(judgeArmDecision('judge-loop')).toBe('loop.stuck')
    expect(judgeArmDecision('judge-off')).toBeUndefined()
    expect(judgeArmDecision('judge-keep-off')).toBeUndefined()
    expect(judgeArmDecision('judge-pack-off')).toBeUndefined()
    expect(judgeArmDecision('baseline')).toBeUndefined()
    expect(judgeArmBaseline('judge-loop')).toBe('judge-off')
    expect(judgeArmBaseline('judge-context')).toBe('judge-keep-off')
    expect(judgeArmBaseline('judge-triage')).toBe('judge-pack-off')
  })
})
