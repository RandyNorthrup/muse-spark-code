import { SETTING_DEFAULTS } from '../../../src/shared/constants'
import { Usd } from '../../../src/shared/usd'

/** Configured settings after the legacy numeric manifest boundary. */
export function defaultSettings() {
  return {
    ...SETTING_DEFAULTS,
    paidDailyBudgetUsd: Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount(),
    tabDailyBudgetUsd: Usd.from(SETTING_DEFAULTS.tabDailyBudgetUsd).toAmount(),
    modelApiSessionBudgetUsd: Usd.from(SETTING_DEFAULTS.modelApiSessionBudgetUsd).toAmount(),
  }
}
