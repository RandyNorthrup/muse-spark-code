import type { UsdAmount } from '../shared/usdSchema'
// ACP /schedule translates to the same validated requests as the terminal.
import { UI_TEXT } from '../shared/constants'
import { parseScheduleCommand } from '../runtime/schedules/args'
import { runScheduleCommand, type ScheduleControlPort } from '../runtime/schedules/command'

export interface AcpScheduleContext {
  readonly cwd: string
  readonly sessionId: string
  readonly backend: 'museCode' | 'modelApi'
  readonly scheduledPrompts?: boolean
  readonly maxBudgetUsd?: UsdAmount
}
export interface AcpSchedulePort {
  run(text: string, context: AcpScheduleContext): Promise<string>
  holdWorkspace?(cwd: string): Promise<(() => Promise<void>) | undefined>
}

export function acpSchedules(
  controlFor: (context: AcpScheduleContext) => Promise<ScheduleControlPort>,
): AcpSchedulePort {
  return {
    async run(text, context) {
      const tail = text.replace(/^\/schedule(?:\s+|$)/, '').trim()
      // JSON stays intact, including spaces, Unicode and quoted prompt text.
      const draft = /^add\s+([\s\S]+)$/.exec(tail)
      const ordinaryArgs = tail === '' ? ['list'] : tail.split(/\s+/)
      const argv = draft === null ? ordinaryArgs : ['add', '--draft', draft[1] ?? '']
      const parsed = parseScheduleCommand(argv)
      if (
        !parsed.ok ||
        parsed.options.cwd !== undefined ||
        parsed.options.operation === 'run-due' ||
        parsed.options.operation === 'background-maintain'
      )
        return UI_TEXT.scheduleV2.runtime.usage
      const control = await controlFor(context)
      const result = await runScheduleCommand(parsed.options, context.cwd, control)
      return result.warning === undefined ? result.output : `${result.output}\n${result.warning}`
    },
  }
}
