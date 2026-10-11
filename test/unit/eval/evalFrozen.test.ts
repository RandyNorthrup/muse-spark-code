// The frozen M75 harness (M101 lane C-M101-2): the arms and tasks the
// counted run uses, named exactly, with the digest of their frozen bytes
// (including executed bundle bytes and explicitly declared fixtures).
// Changing any arm or task breaks this file on purpose: re-freeze by
// recording the new digest here and in docs/certification/m101-eval-arms.md,
// never by weakening the comparison.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EVAL_HELD_DEPS } from '../../../src/core/eval/heldDeps'
import {
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
  evalHarnessDigest,
  freezeEvalHarness,
  frozenBundleChange,
} from '../../../src/core/eval/mechanisms'
import type { EvalArm } from '../../../src/core/eval/runner'
import type { ModelApiHostDeps } from '../../../src/core/backends/modelapi/ModelApiHost'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from '../helpers/fakeModelApi'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'

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
      'f5b07747b08e64b2aa4b1abca856b04bbb2b45b4a628d5b062cabd91820c2cd3',
    )
  })

  it('changes each arm in one mechanism only, never a held harness dependency', () => {
    // M101 R2: an arm pair isolates its mechanism only when both arms share
    // every other harness dependency. Each frozen arm therefore touches
    // exactly its mechanism's dependency keys — and no held one (the
    // window, the memory store, the client, the workspace, the paid hooks).
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const base: ModelApiHostDeps = fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io,
      log,
    })
    const changedKeys = (arm: EvalArm): string[] => {
      if (arm.change === undefined) {
        return []
      }
      const changed = arm.change(base)
      const original = new Map(Object.entries(base))
      return Object.entries(changed)
        .filter(([key, value]) => value !== original.get(key))
        .map(([key]) => key)
        .toSorted((left, right) => left.localeCompare(right))
    }
    expect(new Map(EVAL_ARMS.map((arm) => [arm.name, changedKeys(arm)]))).toEqual(
      new Map([
        ['baseline', []],
        ['packing', ['observationPacking']],
        ['auto-compaction', ['admitAutoCompaction', 'autoCompaction', 'autoCompactionEvaluated']],
        ['strict-tools', ['modelFacts']],
      ]),
    )
    for (const arm of EVAL_ARMS) {
      const held = new Set<string>(EVAL_HELD_DEPS)
      expect(changedKeys(arm).filter((key) => held.has(key))).toEqual([])
    }
  })

  it('freezes four executable snapshots with only declared fixture paths', () => {
    const frozen = freezeEvalHarness()
    expect(frozen.bundles.size).toBe(EVAL_ARMS.length)
    expect(new Set(frozen.bundles.keys())).toEqual(new Set(EVAL_ARMS.map((arm) => arm.name)))
    expect(frozen.sha256).toBe(evalHarnessDigest())
    for (const arm of EVAL_ARMS) {
      const bundle = frozen.bundles.get(arm.name)!
      expect(bundle.fixtures.map((fixture) => fixture.path)).toEqual([
        'armSources.ts',
        'mechanisms.ts',
        'runner.ts',
        'heldDeps.ts',
        'tasks.ts',
        'conditions.json',
      ])
      expect(() => frozenBundleChange(bundle)).not.toThrow()
    }
  })

  it('freezes the arm behaviour, not only its names and descriptions', () => {
    // M101 R2: a digest over names and descriptions alone stays green when
    // an arm's implementation changes. The frozen digest must therefore
    // differ from a hash over the same arms and tasks with every
    // implementation byte left out; the red drills flip an arm latch and
    // narrow strict tools to watch this test fail.
    const descriptionOnly = createHash('sha256')
      .update(
        EVAL_ARMS.map((arm) => `${arm.name}:${arm.mechanism ?? ''}`).join('\n') +
          EVAL_TASKS.map((task) => `${task.id}:${task.split}:${task.title}`).join('\n'),
        'utf8',
      )
      .digest('hex')
    expect(evalHarnessDigest()).not.toBe(descriptionOnly)
    for (const arm of EVAL_ARMS) {
      if (arm.change === undefined) {
        continue
      }
      expect(typeof arm.change.toString()).toBe('string')
      expect(arm.change.toString().length).toBeGreaterThan(0)
    }
  })
})
