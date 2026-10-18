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

/** (5) The connector's integer micro-USD amounts. */
export const SANCTIONED_CONNECTOR_MICROS: PlanCitation = {
  heading: M121,
  phrase:
    "(5) the connector's integer micro-USD amounts (grant paid caps, approval prices), exact integer math end to end and never float, shown as micros until the paid-authority UI decides their display (PR #227, 2026-10-18)",
}

/** (6) The frozen eval plan's recorded budget and measured cost. */
export const SANCTIONED_EVAL_RECORD: PlanCitation = {
  heading: M121,
  phrase:
    "(6) the frozen eval plan's recorded budget and measured cost (`src/core/eval/plan.json`), the live run's own numbers read back for estimates only, never billed or enforced (PR #227, 2026-10-18)",
}
