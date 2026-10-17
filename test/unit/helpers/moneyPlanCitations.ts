import type { PlanCitation } from './planCitation'

// The PLAN.md passages the exact-money guard's `sanctioned` entries cite
// (M121's "Sanctioned numeric money" paragraph, one clause per kind). They
// were line numbers until 2026-10-11; see ./planCitation for why they are not.

const M121 = '### M121 — Exact money everywhere (current money ports) (2026-10-08)'

/** (1) Per-unit rates on a price card or catalog row. */
export const SANCTIONED_RATE: PlanCitation = {
  heading: M121,
  phrase:
    '(1) per-unit rates — USD per million tokens, per token or per hour on a price card or catalog row, display and comparison only, settled through `Usd`',
}

/** (2) Vendor wire units captured as sent. */
export const SANCTIONED_WIRE: PlanCitation = {
  heading: M121,
  phrase:
    '(2) vendor wire units captured as sent (xAI `cost_in_usd_ticks`), converted exactly at the named boundary',
}

/** (3) VS Code number settings and their declared defaults and limits. */
export const SANCTIONED_SETTING: PlanCitation = {
  heading: M121,
  phrase: '(3) VS Code number settings and their declared defaults/limits',
}

/** (4) The estimator's USD/hour demand quantities. */
export const SANCTIONED_ESTIMATOR: PlanCitation = {
  heading: M121,
  phrase:
    "(4) the estimator's demand quantities (RVM121A P3-3, 2026-10-09: `accountUsdPerHour` and the `usd` rate read from it)",
}

export const MONEY_PLAN_CITATIONS: readonly PlanCitation[] = [
  SANCTIONED_RATE,
  SANCTIONED_WIRE,
  SANCTIONED_SETTING,
  SANCTIONED_ESTIMATOR,
]
