// dist/runtimePanelPorts.js (M104 lane B, PLAN.md D84, D6): the heavier ports of
// a runtime panel's conversations, required the first time one is used so the
// session bundle stays within its budget. Saved plans today (int's plan store
// over `.agents/plans/`, its Markdown reader and Plans… list are bundles of
// their own); the checkpoint store joins it. The language is installed here,
// as every lazy bundle's entry does, before the port is built.
import type { PlanFiles } from '../../host/conversation/conversationController'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createRuntimePlans, type RuntimePlansDeps } from '../features/plans'

export function createPlans(deps: RuntimePlansDeps, table: UiText, locale: string): PlanFiles {
  setUiText(table, locale)
  return createRuntimePlans(deps)
}
