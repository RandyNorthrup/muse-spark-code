import { scheduleV2Schema, type ScheduleV2 } from '../../shared/scheduleV2'
import { UI_TEXT } from '../../shared/constants'
import { Usd, minUsd, type UsdAmount } from '../../shared/usd'

/**
 * The schedule's own caps for one fire: the consent's daily cap within the
 * schedule and grant caps. A schedule without consent admits no paid fire.
 */
export function scheduleOwnCapUsd(schedule: ScheduleV2): UsdAmount | undefined {
  const consent = scheduleV2Schema.parse(schedule).paidConsent
  return consent === undefined
    ? undefined
    : minUsd(consent.dailyCapUsd, schedule.paidCapUsd, schedule.grant.paidCapUsd)
}

/**
 * Refuse a fire whose estimate passes the schedule's own caps, with the cap
 * sentence. The person's shared daily limit is enforced by the ledger's own
 * admission beside this check; nothing is held for the fire here (D121).
 */
export function assertScheduleOwnCap(schedule: ScheduleV2, estimateUsd: UsdAmount): void {
  const cap = scheduleOwnCapUsd(schedule)
  if (cap === undefined || Usd.from(estimateUsd).compare(Usd.from(cap)) > 0)
    throw new Error(UI_TEXT.scheduleV2.messages.capReached)
}
