// The VS Code side of scheduled prompts v2 (M115, PLAN.md D95): loads the
// lazy schedules bundle in the extension host and answers the panel's
// versioned channel over the same workspace control the CLI uses. Paid
// drafts stay refused here until the paid consent flow supplies its flags;
// the engine enforces that, never the panel.
import path from 'node:path'
import { workspaceKey } from '../../runtime/dataFolder'
import { runtimeSchedulesBinding } from '../../runtime/schedules/binding'
import type { Logger } from '../logger'
import { MILLISECONDS_PER_HOUR, type SCHEDULE_DELIVERIES, UI_TEXT } from '../../shared/constants'
import type { ScheduleDraft, ScheduleTarget } from '../../shared/scheduleV2'
import type { ScheduleTargetChoice } from '../../webview/schedules/ports'

export interface SchedulesPanelSession {
  readonly sessionId: string
  readonly backend: 'museCode' | 'modelApi'
  readonly label: string
}

export interface SchedulesBridgeDeps {
  readonly distDir: string
  readonly log: Logger
  readonly isEnabled: () => boolean
  readonly defaultDelivery: () => (typeof SCHEDULE_DELIVERIES)[number]
}

export type SchedulesBridge = ReturnType<typeof createSchedulesBridge>

const targets = (session: SchedulesPanelSession | undefined): readonly ScheduleTargetChoice[] => {
  if (session === undefined) return []
  const target: ScheduleTarget = {
    kind: 'conversation',
    sessionId: session.sessionId,
    backend: session.backend,
  }
  return [
    { id: 'this-conversation', label: session.label, target, capability: { available: true } },
  ]
}
/** One bridge per conversation panel; the bundle loads on first schedule use. */
export function createSchedulesBridge(deps: SchedulesBridgeDeps) {
  const load = runtimeSchedulesBinding(path.join(deps.distDir, 'schedules.js'), deps.log)
  const keyFor = (cwd: string): string => workspaceKey(path.resolve(cwd))
  const defaultDraft = (
    nowMs: number,
    session: SchedulesPanelSession | undefined,
    backend: 'museCode' | 'modelApi',
  ): ScheduleDraft => {
    const choices = targets(session)
    // A valid template, not a blank: the wire schema and the prompt mapper
    // both refuse empty names and prompts, and the editor validates before
    // saving, so the user replaces this text.
    return {
      name: UI_TEXT.scheduleV2.editor.defaultName,
      action: { kind: 'prompt', prompt: UI_TEXT.scheduleV2.editor.defaultPrompt },
      trigger: { kind: 'once', atMs: nowMs + MILLISECONDS_PER_HOUR },
      target: choices[0]?.target ?? { kind: 'newConversation', backend },
      delivery: deps.defaultDelivery(),
      whenClosed: 'open',
      catchUp: 'runOnce',
      mode: 'manual',
      grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
      paidCapUsd: 0,
      parallel: false,
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      pinned: false,
    }
  }
  return {
    keyFor,
    targets,
    defaultDraft,
    async message(input: unknown, cwd: string): Promise<unknown> {
      if (!deps.isEnabled()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const binding = await load()
      return await binding.message(input, cwd)
    },
  }
}
