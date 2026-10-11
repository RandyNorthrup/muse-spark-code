// Lane E's call plan (M101 C-M101-3, part A; R2 exactness): scripts/m101-e.mjs
// --plan runs offline and prints the counted run's model calls before
// anything sends. The printed plan is EXACTLY what the run may send — no
// probe, no other batch runs under it — and the hard ceiling equals the
// plan. This pins its numbers against the frozen task set and arms, so the
// plan cannot drift from what the counted run executes.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { EVAL_ARMS } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../../src/shared/constants'

const planScript = fileURLToPath(new URL('../../../scripts/m101-e.mjs', import.meta.url))

const planSchema = z.object({
  model: z.string(),
  tasks: z.object({ total: z.number(), small: z.number(), longContext: z.number() }),
  arms: z.array(
    z.object({ name: z.string(), smallAttempts: z.number(), longAttempts: z.number() }),
  ),
  plannedCalls: z.number(),
  callCeiling: z.number(),
  budgetUsd: z.number(),
})

function loadPlan(): z.infer<typeof planSchema> {
  const stdout = execFileSync(process.execPath, [planScript, '--plan'], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  return planSchema.parse(JSON.parse(stdout) as unknown)
}

describe('the lane E call plan', () => {
  it('counts the frozen task set', () => {
    const plan = loadPlan()
    expect(plan.model).toBe(EVAL_MODEL_ID)
    expect(plan.tasks.total).toBe(EVAL_TASKS.length)
    expect(plan.tasks.longContext).toBe(
      EVAL_TASKS.filter((task) => task.isLongContext === true).length,
    )
    expect(plan.tasks.small).toBe(EVAL_TASKS.filter((task) => task.isLongContext !== true).length)
    expect(plan.arms.map((arm) => arm.name)).toEqual(EVAL_ARMS.map((arm) => arm.name))
  })

  it('plans every arm run from the fake-pair evidence, under a hard ceiling', () => {
    const plan = loadPlan()
    const small = plan.tasks.small
    const long = plan.tasks.longContext
    const base = plan.arms.reduce(
      (total, arm) => total + small * arm.smallAttempts + long * arm.longAttempts,
      0,
    )
    // The printed plan is exactly what runs: nothing else sends under it,
    // so no probe rides along uncounted.
    expect(plan.plannedCalls).toBe(base)
    // The certification band is about 150-300 calls: the plan sits inside
    // it, and the ceiling IS the plan — a run that would exceed it stops
    // and is incomplete, never a pass.
    expect(plan.plannedCalls).toBeGreaterThanOrEqual(150)
    expect(plan.plannedCalls).toBeLessThanOrEqual(300)
    expect(plan.callCeiling).toBe(plan.plannedCalls)
    expect(plan.budgetUsd).toBe(EVAL_BUDGET_USD)
  })
})
