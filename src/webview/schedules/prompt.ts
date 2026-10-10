import { SCHEDULE_LIFETIME_MS, SCHEDULE_MIN_INTERVAL_MS, UI_TEXT } from '../../shared/constants'
import type { LoopParseResult } from '../../core/backends/modelapi/schedules'
import {
  scheduleDraftSchema,
  scheduleRequestSchema,
  type ScheduleDraft,
  type ScheduleRequest,
} from '../../shared/scheduleV2'

export type SchedulePromptAction =
  | {
      readonly kind: 'open'
      readonly view: 'list' | 'timeline' | 'editor'
      readonly draft?: ScheduleDraft
    }
  | { readonly kind: 'request'; readonly request: ScheduleRequest }
  | { readonly kind: 'refused'; readonly reason: string }

/** W calls this before an ordinary submit on either backend. The loop parser
 * is injected from T: its grammar is retained, rather than duplicated here. */
export function schedulePromptAction(
  text: string,
  workspaceKey: string,
  defaultDraft: ScheduleDraft,
  nowMs: number,
  parseLoop: (text: string) => LoopParseResult | undefined,
): SchedulePromptAction | undefined {
  const loop = parseLoop(text)
  if (loop !== undefined) {
    if (!loop.ok) return { kind: 'refused', reason: UI_TEXT.loopSyntax }
    const command = loop.command
    if (command.verb === 'list') return { kind: 'open', view: 'list' }
    if (command.verb === 'cancel')
      return checkedRequest({ method: 'schedules/remove', workspaceKey, id: command.id })
    const trigger =
      command.cadence.kind === 'cron'
        ? command.cadence
        : { ...command.cadence, anchorMs: nowMs + command.cadence.everyMs }
    return checkedDraft({
      ...defaultDraft,
      action: { kind: 'prompt', prompt: command.prompt },
      trigger,
      end: { atMs: nowMs + SCHEDULE_LIFETIME_MS },
    })
  }
  const match = /^\/schedule(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (match === null) return undefined
  const args = match[1]?.trim() ?? ''
  if (args === '' || args === 'list') return { kind: 'open', view: 'list' }
  if (args === 'timeline') return { kind: 'open', view: 'timeline' }
  if (args === 'add') return checkedDraft(defaultDraft)
  if (args.startsWith('add '))
    return checkedDraft({
      ...defaultDraft,
      action: { kind: 'prompt', prompt: args.slice('add '.length).trim() },
      trigger: { kind: 'once', atMs: nowMs + SCHEDULE_MIN_INTERVAL_MS },
    })
  const words = /^(\S+)\s+(\S+)$/.exec(args)
  const verb = words?.[1]
  const id = words?.[2]
  const methods: Readonly<Record<string, Extract<ScheduleRequest, { id: string }>['method']>> = {
    remove: 'schedules/remove',
    'run-now': 'schedules/runNow',
    pause: 'schedules/pause',
    resume: 'schedules/resume',
    fire: 'schedules/fire',
  }
  const method = verb === undefined ? undefined : methods[verb]
  return id === undefined || method === undefined
    ? { kind: 'refused', reason: UI_TEXT.scheduleV2.editor.invalid }
    : checkedRequest({ method, workspaceKey, id })
}

function checkedDraft(input: unknown): SchedulePromptAction {
  const parsed = scheduleDraftSchema.safeParse(input)
  return parsed.success
    ? { kind: 'open', view: 'editor', draft: parsed.data }
    : { kind: 'refused', reason: UI_TEXT.scheduleV2.editor.invalid }
}
function checkedRequest(input: unknown): SchedulePromptAction {
  const parsed = scheduleRequestSchema.safeParse(input)
  return parsed.success
    ? { kind: 'request', request: parsed.data }
    : { kind: 'refused', reason: UI_TEXT.scheduleV2.editor.invalid }
}
