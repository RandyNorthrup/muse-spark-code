// M115 X: parsing does not load the schedule engine into ACP's startup bundle.
import { parseArgs } from 'node:util'
import { SCHEDULE_TIMELINE_HOURS, UI_TEXT } from '../../shared/constants'

export interface ScheduleCommandOptions {
  readonly operation:
    | 'add'
    | 'list'
    | 'remove'
    | 'run-now'
    | 'pause'
    | 'resume'
    | 'timeline'
    | 'fire'
    | 'run-due'
    | 'background-off'
    | 'background-status'
    | 'background-maintain'
  readonly cwd?: string
  readonly isJson: boolean
  readonly id?: string
  readonly draft?: string
  readonly hours?: string
  readonly scheduledPrompts?: boolean
  readonly maxBudgetUsd?: number
  readonly registrationId?: string
}

/** Trusted host metadata, never read from a schedule draft or transport frame. */
export interface ScheduleCallerContext {
  readonly source: 'cli' | 'acp' | 'interactive'
  readonly isInteractive: boolean
  readonly scheduledPrompts: boolean
  readonly maxBudgetUsd?: number
  readonly sessionId?: string
  readonly backend?: 'museCode' | 'modelApi'
}

export function scheduleBudgetUsd(value: string): number | undefined {
  const amount = Number(value)
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(amount) ? amount : undefined
}

export type ScheduleCommandParse =
  | { readonly ok: true; readonly options: ScheduleCommandOptions }
  | { readonly ok: false; readonly reason: string }

export function parseScheduleCommand(argv: readonly string[]): ScheduleCommandParse {
  const refused = (): ScheduleCommandParse => ({
    ok: false,
    reason: UI_TEXT.scheduleV2.runtime.usage,
  })
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        cwd: { type: 'string' },
        json: { type: 'boolean' },
        draft: { type: 'string' },
        hours: { type: 'string' },
        'scheduled-prompts': { type: 'boolean' },
        'max-budget-usd': { type: 'string' },
        registration: { type: 'string' },
      },
    })
    const [operation, argument, ...extra] = positionals
    if (extra.length > 0 || values.cwd === '') return refused()
    if (
      values.registration !== undefined &&
      (operation !== 'run-due' ||
        !/^muse-spark-code-schedules-[a-f0-9]{64}$/.test(values.registration))
    )
      return refused()
    const common = {
      isJson: values.json === true,
      ...(values.cwd !== undefined && { cwd: values.cwd }),
      ...(values.registration !== undefined && { registrationId: values.registration }),
    }
    if (operation === 'add') {
      const budget =
        values['max-budget-usd'] === undefined
          ? undefined
          : scheduleBudgetUsd(values['max-budget-usd'])
      if (budget === undefined && values['max-budget-usd'] !== undefined) return refused()
      return argument !== undefined ||
        values.draft === undefined ||
        values.draft === '' ||
        values.hours !== undefined
        ? refused()
        : {
            ok: true,
            options: {
              ...common,
              operation,
              draft: values.draft,
              ...(values['scheduled-prompts'] !== undefined && {
                scheduledPrompts: values['scheduled-prompts'],
              }),
              ...(budget !== undefined && { maxBudgetUsd: budget }),
            },
          }
    }
    if (values['scheduled-prompts'] !== undefined || values['max-budget-usd'] !== undefined)
      return refused()
    if (values.draft !== undefined) return refused()
    if (operation === 'timeline') {
      if (
        argument !== undefined ||
        (values.hours !== undefined &&
          SCHEDULE_TIMELINE_HOURS.every((hours) => String(hours) !== values.hours))
      )
        return refused()
      return {
        ok: true,
        options: {
          ...common,
          operation,
          ...(values.hours !== undefined && { hours: values.hours }),
        },
      }
    }
    if (values.hours !== undefined) return refused()
    if (operation === 'background') {
      if (values.cwd !== undefined || (argument !== 'off' && argument !== 'status'))
        return refused()
      return {
        ok: true,
        options: {
          ...common,
          operation: argument === 'off' ? 'background-off' : 'background-status',
        },
      }
    }
    switch (operation) {
      case 'list':
      case 'run-due':
      case 'background-maintain': {
        return argument !== undefined || (operation !== 'list' && values.cwd !== undefined)
          ? refused()
          : { ok: true, options: { ...common, operation } }
      }
      case 'remove':
      case 'run-now':
      case 'pause':
      case 'resume':
      case 'fire': {
        return argument === undefined || argument === ''
          ? refused()
          : { ok: true, options: { ...common, operation, id: argument } }
      }
      default: {
        return refused()
      }
    }
  } catch {
    // A malformed option must never echo a prompt or unknown credential argument.
    return refused()
  }
}
