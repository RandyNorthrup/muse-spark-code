import { scheduledReportActionSchema, type ScheduledReportAction } from './types'
import type { ReportOptions } from '../../../shared/reportSchema'

export interface ReportScheduleEditorPort {
  // V/X/M115 bind the same shared editor on every host. No new scheduler or
  // parallel slash parser is invented here; X supplies its parsed options.
  openReportSchedule(options: ReportOptions): Promise<void>
  saveReportSchedule(action: ScheduledReportAction): Promise<void>
}
export async function openReportSchedule(
  options: ReportOptions,
  flags: readonly string[],
  port: ReportScheduleEditorPort,
): Promise<'opened' | 'ignored'> {
  if (!flags.includes('--schedule')) return 'ignored'
  await port.openReportSchedule(options)
  return 'opened'
}
export async function saveReportSchedule(
  input: unknown,
  port: ReportScheduleEditorPort,
): Promise<void> {
  await port.saveReportSchedule(scheduledReportActionSchema.parse(input))
}
