import { UI_TEXT } from '../../shared/constants'
import type { MakerWarning } from '../../shared/makerProtocol'

export function makerWarningText(warning: MakerWarning): string {
  return {
    physicalStopRequired: UI_TEXT.makerPhysicalStopRequired,
    startupMotion: UI_TEXT.makerStartupMotion,
    limitsUnavailable: UI_TEXT.makerLimitsUnavailable,
    auditUnrecorded: UI_TEXT.makerAuditUnrecorded,
    sentOutcomeUnknown: UI_TEXT.makerSentOutcomeUnknown,
  }[warning]
}
