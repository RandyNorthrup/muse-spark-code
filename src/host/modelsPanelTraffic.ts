import {
  trafficMessageSchema,
  trafficSliceSchema,
  runnersMessageSchema,
  runnersSliceSchema,
  type TrafficMessage,
  type TrafficSlice,
  type RunnersMessage,
  type RunnersSlice,
} from '../shared/modelsPanel'
import { UI_TEXT } from '../shared/l10n/text'

/** The lazy team/panel adapters own mutation, retirement and permission cards.
 * Dispatch must repeat admission after every asynchronous wait. Confirmation
 * runs in the existing host approval UI and never implies paid consent.
 */
export interface TrafficPanelDependencies {
  traffic(): Promise<TrafficSlice>
  runners(): Promise<RunnersSlice>
  confirm(message: TrafficMessage): Promise<boolean>
  notify(message: string): Promise<void>
  dispatchTraffic(message: TrafficMessage): Promise<void>
  dispatchRunners(message: RunnersMessage): Promise<void>
}

function isCurrentTarget(message: TrafficMessage, state: TrafficSlice): boolean {
  if (!('expected' in message)) return true
  let target: unknown
  switch (message.type) {
    case 'traffic/task': {
      target = {
        task: state.board.tasks.find((row) => row.id === message.taskId),
        availability: state.taskActions.find(
          (row) => row.taskId === message.taskId && row.attempt === message.attempt,
        ),
        destination:
          message.action === 'reassign'
            ? state.entries.find((row) => row.id === message.entryId)
            : undefined,
      }
      break
    }
    case 'traffic/resource': {
      target = state.resources.find((row) => row.id === message.resourceId)
      break
    }
    case 'traffic/recovery': {
      target = state.recovery.find((row) => row.id === message.recoveryId)
      break
    }
    case 'traffic/conflict': {
      target = state.conflicts.find((row) => row.id === message.conflictId)
      break
    }
    case 'traffic/merge': {
      target = state.mergeQueue.find((row) => row.taskId === message.taskId)
      break
    }
    case 'traffic/cleanup': {
      target = state.copies.find((row) => row.taskId === message.taskId)
      break
    }
  }
  // Both projections have passed the same schema, which fixes object key order.
  return JSON.stringify(target) === JSON.stringify(message.expected)
}

function isAvailable(message: TrafficMessage, state: TrafficSlice): boolean {
  if (
    message.workspaceId !== state.board.workspaceId ||
    message.windowInstanceId !== state.board.windowInstanceId
  )
    return false
  switch (message.type) {
    case 'traffic/load':
    case 'traffic/queue': {
      return true
    }
    case 'traffic/window': {
      return state.windows.some((hint) => hint.windowInstanceId === message.otherWindowId)
    }
    case 'traffic/task': {
      const task = state.board.tasks.find((row) => row.id === message.taskId)
      const actions = state.taskActions.find(
        (row) => row.taskId === message.taskId && row.attempt === message.attempt,
      )
      if (task?.currentAttempt !== message.attempt || !actions?.actions.includes(message.action))
        return false
      return message.action === 'priority'
        ? message.priority !== undefined
        : message.action !== 'reassign' ||
            state.entries.some(
              (entry) => entry.id === message.entryId && entry.roleId === task.roleId,
            )
    }
    case 'traffic/resource': {
      return state.resources.some(
        (row) => row.id === message.resourceId && row.actions.includes(message.action),
      )
    }
    case 'traffic/recovery': {
      const row = state.recovery.find((item) => item.id === message.recoveryId)
      if (!row?.actions.includes(message.action)) return false
      if (row.ownerMayBeLive && ['resume', 'discard', 'recover', 'stop'].includes(message.action))
        return false
      if (message.action === 'recover' && row.lockPath !== undefined) return false
      return true
    }
    case 'traffic/conflict': {
      return state.conflicts.some(
        (row) => row.id === message.conflictId && row.actions.includes(message.action),
      )
    }
    case 'traffic/merge': {
      return state.mergeQueue.some(
        (row) => row.taskId === message.taskId && row.actions.includes(message.action),
      )
    }
    case 'traffic/cleanup': {
      return state.copies.some(
        (row) =>
          row.taskId === message.taskId && (row.state === 'merged' || row.state === 'discarded'),
      )
    }
  }
}

function shouldAsk(message: TrafficMessage): boolean {
  if (message.type === 'traffic/task')
    return ['handOffAnyway', 'continueAnyway', 'restartTeamHost', 'cancel', 'reassign'].includes(
      message.action,
    )
  if (['traffic/resource', 'traffic/conflict', 'traffic/cleanup'].includes(message.type))
    return true
  return message.type === 'traffic/recovery'
    ? ['stop', 'takeOver', 'discard', 'resume', 'recover'].includes(message.action)
    : message.type === 'traffic/merge' && message.action !== 'openTerminal'
}

/** Accept only the owned namespaces. Every boundary is parsed before use. */
export async function handleTrafficMessage(
  raw: unknown,
  deps: TrafficPanelDependencies,
): Promise<{ handled: boolean }> {
  const parsed = trafficMessageSchema.safeParse(raw)
  if (!parsed.success) return { handled: false }
  const message = parsed.data
  const state = trafficSliceSchema.parse(await deps.traffic())
  if (!isCurrentTarget(message, state)) {
    await deps.notify(UI_TEXT.teamTrafficDetails.changedSinceOpened)
    return { handled: false }
  }
  if (!isAvailable(message, state)) return { handled: false }
  if (shouldAsk(message)) {
    if (!(await deps.confirm(message))) return { handled: false }
    // A card can outlive an attempt, lock or ownership change.
    const current = trafficSliceSchema.parse(await deps.traffic())
    if (!isCurrentTarget(message, current) || !isAvailable(message, current)) {
      await deps.notify(UI_TEXT.teamTrafficDetails.changedSinceOpened)
      return { handled: false }
    }
  }
  await deps.dispatchTraffic(message)
  return { handled: true }
}

export async function handleRunnersMessage(
  raw: unknown,
  deps: TrafficPanelDependencies,
): Promise<{ handled: boolean }> {
  const parsed = runnersMessageSchema.safeParse(raw)
  if (!parsed.success) return { handled: false }
  const message = parsed.data
  const state = runnersSliceSchema.parse(await deps.runners())
  if ((message.type === 'runners/test' || message.type === 'runners/testAll') && !state.trusted)
    return { handled: false }
  if (
    (message.type === 'runners/test' || message.type === 'runners/remove') &&
    state.runners.every((runner) => runner.id !== message.runnerId)
  )
    return { handled: false }
  await deps.dispatchRunners(message)
  return { handled: true }
}
