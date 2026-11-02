// RLF-PINNED: the pinned pair's frozen options, built through the real
// frozen path (esbuild plus the restricted child), and the side
// constraints the real capture reads out of the real task prompts — the
// pair measures only what those prompts actually pin.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPinnedConstraints } from '../../../src/core/backends/modelapi/constraintPins'
import { armRepoRoot, buildArmBundle, executeArmBundle } from '../../../src/core/eval/armSources'
import { PINNED_EVAL_ARMS } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'

const ARM_PROGRAM = 'src/core/eval/armDefinitions.ts'

const optionsOf = (name: string): unknown =>
  executeArmBundle(buildArmBundle(path.join(armRepoRoot(), ARM_PROGRAM), name))

describe('pinned eval pair (RLF-PINNED)', () => {
  it('differs by pinning alone', () => {
    expect(optionsOf('auto-compaction')).toEqual({
      name: 'auto-compaction',
      autoCompaction: true,
      autoCompactionEvaluated: true,
      evaluationAdmission: true,
    })
    expect(optionsOf('auto-compaction-pinned')).toEqual({
      name: 'auto-compaction-pinned',
      autoCompaction: true,
      autoCompactionEvaluated: true,
      evaluationAdmission: true,
      constraintPinning: true,
    })
    expect(PINNED_EVAL_ARMS.map((arm) => arm.name)).toEqual([
      'auto-compaction',
      'auto-compaction-pinned',
    ])
  })

  it('pins exactly the stated constraint from each side-constraint prompt', () => {
    const pinnedByTask = new Map(
      EVAL_TASKS.filter((task) => task.isSideConstraint === true).map((task) => [
        task.id,
        extractPinnedConstraints(task.prompt),
      ]),
    )
    expect(pinnedByTask.get('accept-pinned-var-long-compaction')).toEqual([
      'Always declare variables with var in transform.js (this codebase keeps its legacy style).',
    ])
    expect(pinnedByTask.get('accept-pinned-file-long-compaction')).toEqual([
      'Never modify helper.js; it is shared and already correct.',
    ])
    expect(pinnedByTask.get('heldout-pinned-interval-long-compaction')).toEqual([
      'Never use setTimeout in poll.js; keep the interval timer.',
    ])
    expect(pinnedByTask.get('heldout-pinned-exports-long-compaction')).toEqual([
      'Always keep bounds.js to named exports only; never add a default export.',
    ])
  })
})
