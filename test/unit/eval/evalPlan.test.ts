// Lane E's call plan (M101 C-M101-3, part A): scripts/m101-e.mjs --plan runs
// offline and prints the counted run's model calls before anything sends.
// This pins its numbers against the frozen task set and arms, so the plan
// cannot drift from what the counted run executes.

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
  cacheProbeAttempts: z.number(),
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
    expect(plan.plannedCalls).toBe(base + plan.cacheProbeAttempts)
    // The certification band is about 150-300 calls: the plan sits inside
    // it, and the ceiling stops the run at its edge.
    expect(plan.plannedCalls).toBeGreaterThanOrEqual(150)
    expect(plan.callCeiling).toBe(300)
    expect(plan.plannedCalls).toBeLessThanOrEqual(plan.callCeiling)
    expect(plan.budgetUsd).toBe(EVAL_BUDGET_USD)
  })
})
