// M115 X: parsing does not load the schedule engine into ACP's startup bundle.
import { parseArgs } from 'node:util'
import { UI_TEXT } from '../../shared/constants'

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
  readonly cwd?: string
  readonly isJson: boolean
  readonly id?: string
  readonly draft?: string
  readonly hours?: string
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
      },
    })
    const [operation, argument, ...extra] = positionals
    if (extra.length > 0 || values.cwd === '') return refused()
    const common = {
      isJson: values.json === true,
      ...(values.cwd !== undefined && { cwd: values.cwd }),
    }
    if (operation === 'add') {
      return argument !== undefined ||
        values.draft === undefined ||
        values.draft === '' ||
        values.hours !== undefined
        ? refused()
        : { ok: true, options: { ...common, operation, draft: values.draft } }
    }
    if (values.draft !== undefined) return refused()
    if (operation === 'timeline') {
      if (
        argument !== undefined ||
        (values.hours !== undefined && values.hours !== '24' && values.hours !== '168')
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
    if (operation === 'list' || operation === 'run-due') {
      return argument !== undefined || (operation === 'run-due' && values.cwd !== undefined)
        ? refused()
        : { ok: true, options: { ...common, operation } }
    }
    switch (operation) {
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
