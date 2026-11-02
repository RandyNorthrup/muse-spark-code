// A timed send's unsent outcome, said in the conversation (M88 lane
// C, D67 item 15): a refused, skipped or missed once-send is never
// silent. A turn that ran or failed speaks for itself, so those stay
// quiet, and recurring schedules and report actions are not timed
// sends. The reason is the settlement's own, already person-visible
// in the run history; the fallback covers a record without one.
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { AttentionNotice } from '../conversation/turnNotifications'
import type { ScheduleDeliveryResult, ScheduleV2 } from '../../shared/scheduleV2'

export function onceOutcomeNotice(
  result: ScheduleDeliveryResult,
  schedule: ScheduleV2,
): AttentionNotice | undefined {
  if (
    schedule.action.kind !== 'prompt' ||
    schedule.trigger.kind !== 'once' ||
    (result.outcome !== 'refused' && result.outcome !== 'skipped' && result.outcome !== 'missed')
  ) {
    return undefined
  }
  const template = {
    refused: UI_TEXT.timedSendRefused,
    skipped: UI_TEXT.timedSendSkipped,
    missed: UI_TEXT.timedSendMissed,
  }[result.outcome]
  // Every refused, skipped or missed construction sets a reason; the
  // fallback keeps a reason-less record said instead of silent. It
  // matches the unsettled default (targetClosed) and the stored fill
  // (terminalReason), except a refused fire, which is never the
  // target's doing.
  const reason =
    result.reason ??
    (result.outcome === 'refused'
      ? UI_TEXT.scheduleV2.messages.targetUnavailable
      : UI_TEXT.scheduleV2.messages.targetClosed)
  return {
    key: `schedule-outcome:${result.runId}`,
    message: fill(template, { name: schedule.name, reason }),
  }
}

export interface OnceOutcomeVoice {
  /** Says the text in the conversation. Must never throw. */
  readonly notice: (text: string) => void
  /** Raises it while unfocused (M82 decides). Must never throw. */
  readonly attention: (notice: AttentionNotice) => void
}

/** Says an unsent once-send's outcome, or nothing when there is none. */
export function voiceOnceOutcome(
  result: ScheduleDeliveryResult,
  schedule: ScheduleV2,
  voice: OnceOutcomeVoice,
): void {
  const notice = onceOutcomeNotice(result, schedule)
  if (notice === undefined) return
  voice.notice(notice.message)
  voice.attention(notice)
}
