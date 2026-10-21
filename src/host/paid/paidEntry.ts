// The paid features' bundle (dist/paid.js, PLAN.md D6): the paid gate, use
// consent, usage and quote authority load the first time a paid path needs
// them; activation keeps only the bundle loader. The bundle keeps
// its own installed-language state, so the factory installs the caller's
// table from its deps before anything reads it.

import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createPaidFeatures, type PaidFeatures, type PaidFeaturesDeps } from './paidHost'

/** The paid-use popup, for hosts that reach it past the activation split. */
export { askPaidUse } from './paidHost'

/** Paid features in the calling deps' display language. */
export function createPaid(
  deps: PaidFeaturesDeps & { readonly l10n?: { readonly table: UiText; readonly locale: string } },
): PaidFeatures {
  const { l10n, ...rest } = deps
  if (l10n !== undefined) setUiText(l10n.table, l10n.locale)
  return createPaidFeatures(rest)
}
