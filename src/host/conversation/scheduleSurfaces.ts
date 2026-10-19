// The conversation's schedule surfaces (D6): the delivery target readout,
// the scheduled-question settlement and the schedules panel commands. These
// read controller state through one snapshot (plain data plus bound
// closures), so the methods stay byte-identical while dist/conversation.js
// carries only the snapshot builder and the call sites. Loaded on the first
// schedule delivery, panel command or scheduled question.
import type { AgentSession, BackendKind } from '../../core/agent/agentBackend'
import type { BackendSession } from '../schedules/backgroundTarget'
import type { ScheduleEditorDeliveryPorts } from '../schedules/deliveryBinding'
import type { SchedulesBridge } from '../schedules/schedulesBridge'
import type { AgentEvent } from '../../shared/agentEvents'
import { SCHEDULE_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { NoticeLevel } from './conversationCheckpoints'
import type { QuestionRegistry } from '../../core/questions/registry'
import type { HostToWebviewMessage } from '../../shared/protocol'
import { parseScheduleHostMessage } from '../../shared/scheduleProtocol'
import type { ScheduleCadence, ScheduledPrompt } from '../../shared/schedule'
import type { ScheduleRunContext, ScheduleV2 } from '../../shared/scheduleV2'

/** Everything the schedule surfaces read: plain data plus bound closures. */
export interface ScheduleSnapshot {
  readonly isDisposed: boolean
  readonly admitted: boolean
  readonly trusted: boolean
  readonly workspaceRoot: string | undefined
  readonly bridge: SchedulesBridge | undefined
  readonly sessionKind: BackendKind | undefined
  readonly session: AgentSession | undefined
  readonly activeTurnId: string | undefined
  readonly signal: AbortSignal
  readonly epoch: number
  readonly isSettled: (generation: number) => boolean
  readonly authBackend: BackendKind | undefined
  readonly now: () => number
  readonly revision: () => number
  readonly registries: WeakMap<BackendSession, QuestionRegistry>
  readonly runScheduledOccurrence: ((id: string, occurrenceMs: number) => Promise<void>) | undefined
  readonly confirmScheduledRun:
    ((job: ScheduledPrompt, modelId: string) => Promise<boolean>) | undefined
  readonly isScheduledPaid: (() => boolean) | undefined
  readonly say: (level: NoticeLevel, text: string, redoRestoreId?: string) => void
  readonly notice: (
    level: NoticeLevel,
    text: string,
    redoRestoreId?: string,
    error?: unknown,
  ) => void
  /**
   * Reports a surfaced failure exactly as an error notice does (the person
   * sees the same text; the host log keeps the redacted failure). Named
   * `report` so the catch gate recognises the error sink.
   */
  readonly report: (text: string, error: unknown) => void
  readonly post: (message: HostToWebviewMessage) => void
  readonly attach: (session: BackendSession, backend: BackendKind) => Promise<void>
  readonly forAction: () => Promise<AgentSession | undefined>
  readonly isCurrent: (
    session: AgentSession | undefined,
    generation: number,
  ) => session is AgentSession
  readonly describeError: (error: unknown) => string
  readonly requireModel: (modelId: string) => void
  readonly setRevision: (revision: number) => void
}

export function scheduleTargetOf(
  snapshot: ScheduleSnapshot,
  schedule: ScheduleV2,
): ReturnType<ScheduleEditorDeliveryPorts['findLive']> {
  if (
    snapshot.isDisposed ||
    !snapshot.admitted ||
    !snapshot.trusted ||
    schedule.target.kind !== 'conversation' ||
    snapshot.sessionKind !== schedule.target.backend ||
    snapshot.session?.sessionId !== schedule.target.sessionId
  )
    return undefined
  return {
    agent: snapshot.session,
    status: snapshot.activeTurnId === undefined ? 'idle' : 'running',
    ...(snapshot.activeTurnId !== undefined && { activeTurnId: snapshot.activeTurnId }),
    signal: snapshot.signal,
  }
}

export async function settleScheduledQuestion(
  snapshot: ScheduleSnapshot,
  session: BackendSession,
  event: Extract<AgentEvent, { type: 'questionRequested' }>,
  context: ScheduleRunContext,
): Promise<void> {
  const registry = snapshot.registries.get(session)
  if (registry === undefined) throw new Error(UI_TEXT.questionAnswerFailed)
  await registry.register(
    {
      userInputId: event.userInputId,
      itemId: event.itemId,
      questions: event.questions,
      turnId: context.runId,
    },
    0,
  )
  // The backend performs its captured clarification once. The registry keeps
  // this question open for a later answer without sending a second withdrawal.
  await registry.settle(event.userInputId, 'deferred')
}

export async function scheduleSessionOf(
  snapshot: ScheduleSnapshot,
): Promise<AgentSession | undefined> {
  const generation = snapshot.epoch
  const session = await snapshot.forAction()
  if (!snapshot.isCurrent(session, generation)) {
    return undefined
  }
  if (session.schedules === undefined) {
    snapshot.notice('warning', UI_TEXT.scheduleModelApiOnly)
    return undefined
  }
  return session
}

export async function createScheduleOf(
  snapshot: ScheduleSnapshot,
  cadence: ScheduleCadence,
  prompt: string,
): Promise<void> {
  try {
    const session = await scheduleSessionOf(snapshot)
    const job = await session?.schedules?.create(cadence, prompt)
    if (job !== undefined) {
      snapshot.say('info', fill(UI_TEXT.scheduleCreated, { id: job.id }))
    }
  } catch (error: unknown) {
    snapshot.report(`${UI_TEXT.scheduleCommandFailed}: ${snapshot.describeError(error)}`, error)
  }
}

export async function listSchedulesOf(snapshot: ScheduleSnapshot): Promise<void> {
  try {
    const session = await scheduleSessionOf(snapshot)
    const jobs = await session?.schedules?.list()
    if (jobs?.length === 0) {
      snapshot.say('info', UI_TEXT.scheduleNone)
    }
  } catch (error: unknown) {
    snapshot.report(`${UI_TEXT.scheduleCommandFailed}: ${snapshot.describeError(error)}`, error)
  }
}

export async function answerSchedulesOf(snapshot: ScheduleSnapshot, input: unknown): Promise<void> {
  const bridge = snapshot.bridge
  const workspaceRoot = snapshot.workspaceRoot
  if (bridge === undefined || workspaceRoot === undefined) return
  try {
    const answer = await bridge.message(input, workspaceRoot)
    const parsed = parseScheduleHostMessage(answer)
    if (!parsed.ok) return
    snapshot.post({ type: 'schedulesMessage', message: parsed.message })
    if (
      parsed.message.type === 'schedulesResponse' &&
      parsed.message.response.kind === 'accepted'
    ) {
      const revision = snapshot.revision() + 1
      snapshot.setRevision(revision)
      snapshot.post({
        type: 'schedulesMessage',
        message: {
          type: 'scheduleChanged',
          version: SCHEDULE_PROTOCOL_VERSION,
          workspaceKey: bridge.keyFor(workspaceRoot),
          revision,
        },
      })
    }
  } catch (error: unknown) {
    snapshot.report(`${UI_TEXT.scheduleCommandFailed}: ${snapshot.describeError(error)}`, error)
  }
}

export function scheduleRunChangedOf(snapshot: ScheduleSnapshot): void {
  snapshot.notice(
    'warning',
    snapshot.isScheduledPaid?.() === true
      ? UI_TEXT.scheduleConfirmationExpired
      : UI_TEXT.schedulePaidOff,
  )
}

export async function runScheduleOf(
  snapshot: ScheduleSnapshot,
  id: string,
  occurrenceMs: number,
): Promise<void> {
  const generation = snapshot.epoch
  try {
    if (snapshot.runScheduledOccurrence !== undefined) {
      await snapshot.runScheduledOccurrence(id, occurrenceMs)
      return
    }
    const session = await scheduleSessionOf(snapshot)
    if (!snapshot.isCurrent(session, generation) || session.schedules === undefined) {
      return
    }
    if (snapshot.isScheduledPaid?.() !== true) {
      snapshot.notice('warning', UI_TEXT.schedulePaidOff)
      return
    }
    const jobs = await session.schedules.list()
    if (!snapshot.isCurrent(session, generation)) {
      return
    }
    const job = jobs.find((entry) => entry.id === id)
    if (job?.nextFireAtMs !== occurrenceMs || occurrenceMs > snapshot.now()) {
      snapshot.notice('warning', UI_TEXT.scheduleNotDue)
      return
    }
    if (snapshot.confirmScheduledRun === undefined) {
      return
    }
    const confirmed = {
      sessionId: session.sessionId,
      modelId: session.modelId,
      backend: snapshot.authBackend,
      prompt: job.prompt,
    }
    if (!(await snapshot.confirmScheduledRun(job, confirmed.modelId))) {
      return
    }
    const isContextChanged = () =>
      !snapshot.isCurrent(session, generation) ||
      session.sessionId !== confirmed.sessionId ||
      snapshot.sessionKind !== 'modelApi' ||
      snapshot.authBackend !== confirmed.backend ||
      session.modelId !== confirmed.modelId ||
      snapshot.isScheduledPaid?.() !== true
    if (isContextChanged()) {
      if (snapshot.isSettled(generation)) {
        scheduleRunChangedOf(snapshot)
      }
      return
    }
    const currentJobs = await session.schedules.list()
    const current = currentJobs.find((entry) => entry.id === id)
    if (
      isContextChanged() ||
      current?.nextFireAtMs !== occurrenceMs ||
      current.prompt !== confirmed.prompt
    ) {
      if (snapshot.isSettled(generation)) {
        scheduleRunChangedOf(snapshot)
      }
      return
    }
    snapshot.requireModel(session.modelId)
    await session.schedules.run(id, occurrenceMs, confirmed)
  } catch (error: unknown) {
    // A failed run reports even on a live turn: with the turn settled the
    // notice is the only record, and a live turn must not swallow it either.
    snapshot.report(`${UI_TEXT.scheduleCommandFailed}: ${snapshot.describeError(error)}`, error)
  }
}

export function openSchedulesOf(
  snapshot: ScheduleSnapshot,
  initialView: 'list' | 'timeline' | 'editor',
): void {
  const bridge = snapshot.bridge
  const workspaceRoot = snapshot.workspaceRoot
  if (bridge === undefined || workspaceRoot === undefined) {
    snapshot.notice('warning', UI_TEXT.noWorkspaceReason)
    return
  }
  const session =
    snapshot.session === undefined || snapshot.sessionKind === undefined
      ? undefined
      : {
          sessionId: snapshot.session.sessionId,
          backend: snapshot.sessionKind,
          label: UI_TEXT.scheduleV2.targets.conversation,
        }
  const nowMs = snapshot.now()
  snapshot.post({
    type: 'schedulesSurface',
    workspaceKey: bridge.keyFor(workspaceRoot),
    targets: [...bridge.targets(session)],
    // The session's backend first; 'modelApi' only before any session, for
    // the fallback target the draft needs when no conversation is open.
    defaultDraft: bridge.defaultDraft(
      nowMs,
      session,
      snapshot.sessionKind ?? snapshot.authBackend ?? 'modelApi',
    ),
    nowMs,
    initialView,
  })
}

export async function cancelScheduleOf(snapshot: ScheduleSnapshot, id: string): Promise<void> {
  try {
    const session = await scheduleSessionOf(snapshot)
    if (session?.schedules === undefined) {
      return
    }
    const isRemoved = await session.schedules.cancel(id)
    snapshot.say(
      isRemoved ? 'info' : 'warning',
      fill(isRemoved ? UI_TEXT.scheduleCancelled : UI_TEXT.scheduleUnknown, { id }),
    )
  } catch (error: unknown) {
    snapshot.report(`${UI_TEXT.scheduleCommandFailed}: ${snapshot.describeError(error)}`, error)
  }
}
