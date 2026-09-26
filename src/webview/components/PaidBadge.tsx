import { type PaidFeature, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { paidFeaturePrice } from '../../shared/paid'

/** Shared paid marker for tool and child-agent rows, read in the installed locale. */
export function PaidBadge({ feature }: { readonly feature: PaidFeature }) {
  return (
    <span
      className="badge badge-paid"
      title={fill(UI_TEXT.paidRowTitle, { price: paidFeaturePrice(feature) })}
    >
      {UI_TEXT.paidRowBadge}
    </span>
  )
}
