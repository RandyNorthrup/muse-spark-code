import { UI_TEXT } from '../../shared/constants'
import { scheduleActionSchema, type ScheduleReportAction } from '../../shared/scheduleV2'
import type { ScheduleCommandOptions } from './args'

export interface ScheduleReportCliPort {
  /** M113 X parses the report arguments through its existing parser. Q resolves
   * user-selected paths/addresses into approved opaque ids and completes its
   * preview/verification/consent. Never persist raw addresses or vault values.
   * Return only destination ids whose complete targets the user authorized. */
  resolve(
    kind: string,
    args: readonly string[],
    format: string,
    to: readonly string[],
    cwd: string,
  ): Promise<{ readonly action: ScheduleReportAction; readonly destinationIds: readonly string[] }>
}

export async function scheduleCliReportAction(
  options: ScheduleCommandOptions,
  cwd: string,
  port?: ScheduleReportCliPort,
): Promise<{ action: ScheduleReportAction; destinationIds: readonly string[] }> {
  if (port === undefined) throw new Error(UI_TEXT.scheduleV2.reportAction.unavailable)
  if (options.reportKind === undefined || options.reportTo === undefined)
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  const result = await port.resolve(
    options.reportKind,
    options.reportArgs ?? [],
    options.reportFormat === 'md' ? 'markdown' : (options.reportFormat ?? 'markdown'),
    options.reportTo,
    cwd,
  )
  const action = scheduleActionSchema.parse(result.action)
  const format = options.reportFormat === 'md' ? 'markdown' : (options.reportFormat ?? 'markdown')
  if (
    action.kind !== 'report' ||
    action.reportKind !== options.reportKind ||
    action.format !== format ||
    action.destinations.some((item) => !result.destinationIds.includes(item.id))
  )
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  return { action, destinationIds: action.destinations.map((item) => item.id) }
}
