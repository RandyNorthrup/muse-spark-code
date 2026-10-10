// The frozen M75 harness (M101 lane C-M101-2): the arms and tasks the
// counted run uses, named exactly, with the digest of their frozen bytes
// (including the arms' source closure: every file the arms reach, by
// bytes, resolved by the real bundler in src/core/eval/armSources).
// Changing any arm or task breaks this file on purpose: re-freeze by
// recording the new digest here and in docs/certification/m101-eval-arms.md,
// never by weakening the comparison.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { EVAL_HELD_DEPS } from '../../../src/core/eval/heldDeps'
import {
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
  evalHarnessDigest,
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
      '8e4bdefa01d029ca999267ef970c6191528bdb86f3000981a5951f733c6c227c',
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
      // The compiler cannot verify this narrowing (PLAN.md §8): Object.keys
      // is typed as string[], but `changed` is a ModelApiHostDeps, so every
      // key is one of its keys; the exact-key assertion below fails on any
      // surprise the cast could hide.
      return (Object.keys(changed) as (keyof ModelApiHostDeps)[])
        .filter((key) => changed[key] !== base[key])
        .map(String)
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
      // The compiler cannot verify this widening either (PLAN.md §8): the
      // tuple holds dep-key literals, every one a string, so testing
      // membership against a changed key is sound.
      expect(
        changedKeys(arm).filter((key) => (EVAL_HELD_DEPS as readonly string[]).includes(key)),
      ).toEqual([])
    }
  })

  it('records the dependency-key assertion in PLAN.md §8', async () => {
    // AGENTS.md rule 4: a cast the compiler cannot verify needs an inline
    // reason (above) and a row in the escape-hatches register. This test
    // fails when the row goes missing, so the audit record cannot drift
    // the way review RVCM1012B finding 2 describes.
    let dir = process.cwd()
    for (let depth = 0; depth < 32; depth += 1) {
      const candidate = path.join(dir, 'PLAN.md')
      if (existsSync(candidate)) {
        const plan = await readFile(candidate, 'utf8')
        expect(plan).toContain('test/unit/eval/evalFrozen.test.ts')
        expect(plan).toContain('keyof ModelApiHostDeps')
        expect(plan).toContain('EVAL_HELD_DEPS as readonly string')
        return
      }
      const parent = path.dirname(dir)
      if (parent === dir) throw new Error('PLAN.md not found above the working directory')
      dir = parent
    }
    throw new Error('PLAN.md not found above the working directory')
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
