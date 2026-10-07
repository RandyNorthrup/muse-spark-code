import { type PaidFeature, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { paidFeaturePrice } from '../../shared/paid'

/**
 * Shared paid marker for tool and child-agent rows, read in the installed locale.
 * A Judge row names the feature. Its title is an exact price when the caller
 * has one, and never a list of another provider's rates.
 */
export function PaidBadge({
  feature,
  price,
}: {
  readonly feature: PaidFeature
  readonly price?: string | undefined
}) {
  const quoted =
    price ?? (feature === 'judge' ? UI_TEXT.judgeStatusPaid : paidFeaturePrice(feature))
  const title =
    feature === 'judge' && price === undefined
      ? UI_TEXT.judgeStatusPaid
      : fill(UI_TEXT.paidRowTitle, { price: quoted })
  return (
    <span className="badge badge-paid" title={title}>
      {feature === 'judge' ? UI_TEXT.paidJudgeName : UI_TEXT.paidRowBadge}
    </span>
  )
}
