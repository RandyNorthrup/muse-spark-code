// C-M115-9: the native panel's schedule hold. Each prepared native
// conversation holds its workspace root with a live owner, so a due fire
// delivers into the open JetBrains, Eclipse or Visual Studio session
// instead of a background one. The schedules bundle stays lazy: this file
// carries only the owner shape and the hold state, never the engine.
import type { AgentSession, BackendKind } from '../../core/agent/agentBackend'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { ConversationController } from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import type { RuntimeSchedulesBinding } from '../schedules/binding'
import { UI_TEXT } from '../../shared/constants'

export type PanelSchedulesBindingLoader = () => Promise<RuntimeSchedulesBinding>

/** The backends a scheduled prompt runs on (scheduleV2); never an external agent. */
type ScheduledBackend = Exclude<BackendKind, 'external'>

type PanelScheduleOwner = Pick<ConversationController, 'scheduleNotice' | 'settleScheduledQuestion'>

export interface PanelScheduleHold {
  readonly isHeld: boolean
  hold(
    root: string,
    session: AgentSession,
    backend: ScheduledBackend,
    controller: PanelScheduleOwner,
  ): Promise<void>
  close(): Promise<void>
}

export function createPanelScheduleHold(input: {
  load: PanelSchedulesBindingLoader
  log: Logger
}): PanelScheduleHold {
  let loading: Promise<RuntimeSchedulesBinding> | undefined
  let loaded: RuntimeSchedulesBinding | undefined
  let isClosed = false
  let release: (() => Promise<void>) | undefined
  let sessionId: string | undefined
  let handle: AgentSession | undefined
  const clear = () => {
    release = undefined
    sessionId = undefined
    handle = undefined
  }
  // Overlapping holds are safe: a duplicate live key refuses inside the
  // hold below, and the binding releases every lease it granted at close.
  const holdOne = async (
    root: string,
    session: AgentSession,
    backend: ScheduledBackend,
    controller: PanelScheduleOwner,
  ): Promise<void> => {
    if (handle === session) return
    if (isClosed) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    const previous = release
    clear()
    if (previous !== undefined) {
      try {
        await previous()
      } catch (error: unknown) {
        input.log.warn(`MHP_SCHEDULE_RELEASE_FAILED: ${failureForLog(error)}`)
      }
    }
    try {
      loading ??= input.load()
      const bound = await loading
      loaded = bound
      release = await bound.holdWorkspace(root, {
        agent: session,
        backend,
        row: (text) => {
          controller.scheduleNotice(session, text)
        },
        deferQuestions: (event, context) =>
          controller.settleScheduledQuestion(session, backend, event, context),
      })
      sessionId = session.sessionId
      handle = session
    } catch (error: unknown) {
      input.log.warn(`MHP_SCHEDULE_HOLD_FAILED: ${failureForLog(error)}`)
      controller.scheduleNotice(undefined, UI_TEXT.scheduleV2.runtime.hostUnavailable)
    }
  }
  return {
    get isHeld() {
      return sessionId !== undefined
    },
    hold: holdOne,
    async close() {
      isClosed = true
      const previous = release
      clear()
      await previous?.()
      if (loaded !== undefined) await loaded.close()
    },
  }
}
