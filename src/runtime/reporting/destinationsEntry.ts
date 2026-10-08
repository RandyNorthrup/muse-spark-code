// M115 mounts these shared operations when its durable scheduling authority is available.
export { ScheduledReportRunner } from '../../core/reporting/destinations/runner'
export { ReportEmailDelivery, reportMailStateSchema } from '../../core/reporting/destinations/email'
export { ReportPostDelivery } from '../../core/reporting/destinations/post'
export {
  openReportSchedule,
  saveReportSchedule,
} from '../../core/reporting/destinations/scheduleRequest'
export { reportOccurrenceRecordSchema } from '../../core/reporting/destinations/types'
import {
  ScheduledReportRunner,
  type ScheduledReportPorts,
} from '../../core/reporting/destinations/runner'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
export function createReportingDestinations(
  ports: ScheduledReportPorts,
  table: UiText,
  locale: string,
): ScheduledReportRunner {
  setUiText(table, locale)
  return new ScheduledReportRunner(ports)
}
