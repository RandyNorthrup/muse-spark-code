import { type PaidFeature, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { usePaidFeaturePrice } from '../moneyHooks'

/**
Shared paid marker for tool and child-agent rows, read in the installed
locale. The price tooltip waits for the lazy money chunk (STARTUP017):
the badge itself paints with startup, never a guessed price. A Judge row
names the feature; its title is the exact price, never another provider's rates.
*/
export function PaidBadge({ feature }: { readonly feature: PaidFeature }) {
  const price = usePaidFeaturePrice(feature)
  return (
    <span
      className="badge badge-paid"
      title={price === undefined ? undefined : fill(UI_TEXT.paidRowTitle, { price })}
    >
      {feature === 'judge' ? UI_TEXT.paidJudgeName : UI_TEXT.paidRowBadge}
    </span>
  )
}
