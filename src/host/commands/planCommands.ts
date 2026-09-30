// The palette's Plans… (M79, PLAN.md D49): the saved plans, newest first,
// then what to do with the one picked, open it or implement it in a fresh
// conversation. The conversation controller acts on the answer; the picks
// are injected.

import type { PlanSummary } from '../../core/plans/planStore'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { PlanChoice } from '../conversation/conversationController'
import type { PickItem, PickOne } from './pickItem'

const PLAN_PREFIX = 'plan:'
const OPEN = 'open'
const IMPLEMENT = 'implement'

function planItem(plan: PlanSummary, index: number): PickItem {
  return { id: `${PLAN_PREFIX}${String(index)}`, label: plan.title, description: plan.fileName }
}

/** The plan picked and the action chosen for it; undefined when either pick is dismissed. */
export async function choosePlan(
  plans: readonly PlanSummary[],
  pick: PickOne,
): Promise<PlanChoice | undefined> {
  const picked = await pick(
    plans.map((plan, index) => planItem(plan, index)),
    UI_TEXT.plansTitle,
    plural(UI_TEXT.plansCount, plans.length),
  )
  const plan = picked?.startsWith(PLAN_PREFIX)
    ? plans[Number(picked.slice(PLAN_PREFIX.length))]
    : undefined
  if (plan === undefined) {
    return undefined
  }
  const action = await pick(
    [
      { id: OPEN, label: UI_TEXT.planOpen, detail: plan.relativePath },
      { id: IMPLEMENT, label: UI_TEXT.implementPlan, detail: UI_TEXT.planImplementDetail },
    ],
    plan.title,
    plan.fileName,
  )
  if (action === OPEN) {
    return { plan, action: 'open' }
  }
  return action === IMPLEMENT ? { plan, action: 'implement' } : undefined
}
