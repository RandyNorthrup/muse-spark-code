// The frozen M75 harness (M101 lane C-M101-2): the arms and tasks the
// counted run uses, named exactly, with the digest of their frozen bytes.
// Changing any arm or task breaks this file on purpose: re-freeze by
// recording the new digest here and in docs/certification/m101-eval-arms.md,
// never by weakening the comparison.

import { describe, expect, it } from 'vitest'
import {
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
  evalHarnessDigest,
} from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'

describe('the frozen evaluation harness', () => {
  it('freezes the four arms in run order', () => {
    expect(EVAL_ARMS).toEqual([
      BASELINE_ARM,
      OBSERVATION_PACKING_ARM,
      AUTO_COMPACTION_ARM,
      STRICT_TOOLS_ARM,
    ])
    expect(EVAL_ARMS.map((arm) => arm.name)).toEqual([
      'baseline',
      'packing',
      'auto-compaction',
      'strict-tools',
    ])
  })

  it('freezes the sixteen tasks in run order', () => {
    expect(EVAL_TASKS.map((task) => [task.id, task.split])).toEqual([
      ['accept-off-by-one', 'accept'],
      ['accept-null-guard', 'accept'],
      ['accept-await-read', 'accept'],
      ['accept-import-path', 'accept'],
      ['accept-no-secret', 'accept'],
      ['accept-empty-average', 'accept'],
      ['heldout-strict-equal', 'heldout'],
      ['heldout-clear-timer', 'heldout'],
      ['heldout-sort-numbers', 'heldout'],
      ['heldout-await-write', 'heldout'],
      ['accept-long-middle-value', 'accept'],
      ['heldout-long-middle-rule', 'heldout'],
      ['accept-long-compaction', 'accept'],
      ['heldout-long-compaction', 'heldout'],
      ['accept-multi-edit', 'accept'],
      ['heldout-multi-edit', 'heldout'],
    ])
  })

  it('keeps the frozen digest', () => {
    expect(evalHarnessDigest()).toBe(
      '7f6241a64823916d1e9b6c2abf9ff5f7181688a0eaea3f33b679580e70645b26',
    )
  })
})
