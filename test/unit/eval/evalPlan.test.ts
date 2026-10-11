// The printed task/arm allowances are the exact global backstop, including
// narrowed selections. All checks are offline and use the frozen measurement.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { EVAL_ARMS } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'
import measurement from '../../../src/core/eval/plan.json'
import { EVAL_BUDGET_USD, EVAL_MODEL_ID } from '../../../src/shared/constants'

const planScript = fileURLToPath(new URL('../../../scripts/m101-e.mjs', import.meta.url))
const planSchema = z.object({
  model: z.string(),
  tasks: z.array(
    z.object({ id: z.string(), callBudget: z.number(), measuredAttempts: z.array(z.number()) }),
  ),
  arms: z.array(z.string()),
  plannedCalls: z.number(),
  callCeiling: z.number(),
  budgetUsd: z.number(),
  selection: z.string(),
  measuredCostEstimateUsd: z.number(),
})
function loadPlan(selection = ''): z.infer<typeof planSchema> {
  const stdout = execFileSync(process.execPath, [planScript, '--plan'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MUSE_EVAL_TASKS: selection },
  })
  const value: unknown = JSON.parse(stdout)
  return planSchema.parse(value)
}
describe('the lane E call plan', () => {
  it('prints measured per-task budgets, whose sum is the ceiling', () => {
    const plan = loadPlan()
    expect(plan.model).toBe(EVAL_MODEL_ID)
    expect(plan.tasks.map((task) => task.id)).toEqual(EVAL_TASKS.map((task) => task.id))
    expect(plan.arms).toEqual(EVAL_ARMS.map((arm) => arm.name))
    expect(plan.plannedCalls).toBe(
      plan.tasks.reduce((sum, task) => sum + task.callBudget * plan.arms.length, 0),
    )
    expect(plan.plannedCalls).toBe(548)
    expect(plan.callCeiling).toBe(plan.plannedCalls)
    expect(plan.budgetUsd).toBe(EVAL_BUDGET_USD)
    expect(plan.measuredCostEstimateUsd).toBeCloseTo((548 * 0.026384174) / 198, 10)
    for (const task of plan.tasks) {
      const prior = task.id.includes('compaction') ? 6 : 3
      const observed = Math.max(...task.measuredAttempts)
      expect(task.callBudget).toBe(
        Math.max(6, Math.ceil((observed === 0 ? prior : observed) * 1.5)),
      )
    }
    expect(plan.tasks).toEqual(measurement.tasks)
  })
  it('uses only frozen process flags and allowed environment names at real dispatch', () => {
    const probe = String.raw`
const child = require('node:child_process');
const expected = ${JSON.stringify(measurement.execution.arguments)};
const allowed = new Set(${JSON.stringify(measurement.execution.environment)});
let isValid = true; let runs = 0;
process.env.MUSE_EVAL_UNDECLARED = 'private workspace text';
process.env.META_API_KEY = 'synthetic-test-only';
process.env.NODE_OPTIONS = '--no-warnings';
child.spawnSync = (_file, args, options) => {
  runs += 1;
  isValid &&= JSON.stringify(args.slice(1, 1 + expected.length)) === JSON.stringify(expected)
    && Object.keys(options.env).every(name => allowed.has(name.toUpperCase()));
  return { status: 0 };
};
require('node:module').syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(planScript)}, '--fake'];
import(${JSON.stringify(new URL('../../../scripts/m101-e.mjs', import.meta.url).href)})
  .then(() => process.stdout.write(JSON.stringify([isValid, runs]) + '\n'));
`
    const allowed = new Set(measurement.execution.environment)
    const inheritedNames = Object.keys(process.env).filter((name) =>
      allowed.has(name.toUpperCase()),
    )
    const env = {
      ...Object.fromEntries(inheritedNames.map((name) => [name, process.env[name]])),
      MUSE_EVAL_TASKS: '',
    }
    const stdout = execFileSync(process.execPath, ['-e', probe], {
      encoding: 'utf8',
      env,
      cwd: path.dirname(path.dirname(planScript)),
    })
    const value: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
    const observed = z.tuple([z.boolean(), z.number()]).parse(value)
    expect(observed[0]).toBe(true)
    expect(observed[1]).toBeGreaterThan(0)
  })

  it('prints the narrowed six-task plan instead of the full ceiling', () => {
    const ids = [
      'accept-off-by-one',
      'heldout-strict-equal',
      ...EVAL_TASKS.slice(0, 4).map((task) => task.id),
    ]
    const plan = loadPlan(ids.join(','))
    expect(plan.selection).toBe('narrowed selection')
    expect(plan.tasks).toHaveLength(6)
    expect(plan.callCeiling).toBe(plan.tasks.reduce((sum, task) => sum + task.callBudget * 4, 0))
    expect(plan.callCeiling).toBe(224)
  })
})
