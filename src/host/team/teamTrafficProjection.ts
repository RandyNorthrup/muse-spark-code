import { trafficSliceSchema, type TrafficSlice } from '../../shared/modelsPanel'
import { UI_TEXT } from '../../shared/l10n/text'
import type { TeamBoard, TeamBoardTask, TeamSharedFile } from '../../shared/team'
import type {
  TeamHostService,
  TeamMergeQueueEvent,
  TeamMergeRefusal,
} from '../../core/team/teamHostService'
import { mergeQueueMetricEvents } from '../../core/team/trafficMetrics'
import type { TeamTreeData } from '../../shared/teamView'
import { plannedConflicts } from '../../core/team/conflictPredict'
import { SharedFiles } from '../../core/team/sharedFiles'
import { trafficMetrics, type TrafficMetricSource } from '../../core/team/trafficMetrics'
import { expandWriteSet } from '../../core/team/writeSets'
import type { WindowHint } from './windowHints'

/** Live recovery rows: uncertain liabilities plus interrupted attempts the old
uncertain-only filter dropped, joined against the host tree so a restored
interrupted task is recoverable even when the board never marked it. Rows
carry only the actions dispatch can honor: while a foreign owner may be
live, takeover must come first; once this window holds the board, the
attempt can resume, be discarded or be stopped outright. */
function recoverInterrupted(
  board: TeamBoard,
  tree: TeamTreeData | undefined,
  windowInstanceId: string,
): TrafficSlice['recovery'] {
  const isOwnerMayBeLive =
    board.owner !== undefined &&
    !board.owner.released &&
    board.owner.windowInstanceId !== windowInstanceId
  const row = (task: TeamBoardTask, detail: string): TrafficSlice['recovery'][number] => ({
    id: task.id,
    kind: 'interrupted',
    generation: task.currentAttempt,
    taskId: task.id,
    attempt: task.currentAttempt,
    ownerMayBeLive: isOwnerMayBeLive,
    windowInstanceId: board.windowInstanceId,
    paths: task.writes ?? [],
    detail,
    actions: isOwnerMayBeLive ? ['takeOver', 'keep'] : ['resume', 'discard', 'stop', 'keep'],
  })
  const uncertain = board.tasks
    .filter(
      (task) =>
        task.state === 'blocked' && task.attempts.some((attempt) => attempt.state === 'uncertain'),
    )
    .map((task) => row(task, task.blockedReason ?? UI_TEXT.teamTrafficNotices.uncertainAttempt))
  const known = new Set(uncertain.map((task) => task.id))
  const interruptedTaskIds: string[] = []
  if (tree !== undefined)
    for (const role of tree.roles)
      for (const task of role.interrupted) interruptedTaskIds.push(task.taskId)
  const interruptedIds = new Set(interruptedTaskIds)
  const settled = new Set(['merged', 'discarded', 'done'])
  const interrupted = board.tasks
    .filter(
      (task) =>
        !known.has(task.id) &&
        ((task.state === 'blocked' &&
          task.attempts.some((attempt) => attempt.state === 'interrupted')) ||
          (interruptedIds.has(task.id) && !settled.has(task.state))),
    )
    .map((task) => row(task, task.blockedReason ?? UI_TEXT.teamTrafficNotices.queuePaused))
  return [...uncertain, ...interrupted]
}

/** Live conflict rows from the declared write sets, not an empty projection. */
function predictConflicts(
  board: TeamBoard,
  sharedFiles: readonly TeamSharedFile[],
): TrafficSlice['conflicts'] {
  const shared = new SharedFiles([], sharedFiles)
  const byId = new Map(board.tasks.map((task) => [task.id, task]))
  return plannedConflicts(
    board.tasks.map((task) => ({
      taskId: task.id,
      set: expandWriteSet(task.writes ?? [], []),
    })),
    shared,
  ).map((conflict) => ({
    id: `${conflict.taskId}--${conflict.otherTaskId}`,
    generation: Math.max(
      byId.get(conflict.taskId)?.currentAttempt ?? 0,
      byId.get(conflict.otherTaskId)?.currentAttempt ?? 0,
    ),
    taskIds: [conflict.taskId, conflict.otherTaskId],
    paths: [...conflict.paths],
    actions: [],
  }))
}

/** Local metric aggregation over the board's durable attempts and transitions. */
function summarizeMetrics(
  board: TeamBoard,
  mergeLog: readonly TeamMergeQueueEvent[],
): TrafficSlice['metrics'][number] {
  const now = Date.now()
  const byId = new Map(board.tasks.map((task) => [task.id, task]))
  const landedAt = new Map<string, number>()
  for (const entry of mergeLog)
    if (entry.kind === 'landed')
      landedAt.set(entry.taskId, Math.max(landedAt.get(entry.taskId) ?? 0, entry.at))
  const events: TrafficMetricSource['events'][number][] = [
    ...mergeQueueMetricEvents(mergeLog, {
      workspaceId: board.workspaceId,
      attemptOf: (taskId) => byId.get(taskId)?.currentAttempt ?? 1,
    }),
  ]
  for (const task of board.tasks) {
    // A ready mark precedes every attempt that started after it; the first
    // start consumes it, so retries never double-count the wait. Ready waits
    // with no attempt yet count toward depth even before the first start.
    if (task.readyAt !== undefined)
      for (const attempt of task.attempts)
        events.push({
          kind: 'ready',
          workspaceId: board.workspaceId,
          taskId: task.id,
          attempt: attempt.number,
          at: Math.min(task.readyAt, attempt.startedAt),
        })
    if (
      (task.state === 'ready' || task.state === 'queued') &&
      task.attempts.length === 0 &&
      task.readyAt !== undefined
    )
      events.push({
        kind: 'ready',
        workspaceId: board.workspaceId,
        taskId: task.id,
        attempt: 1,
        at: task.readyAt,
      })
    for (const attempt of task.attempts) {
      events.push({
        kind: 'started',
        workspaceId: board.workspaceId,
        taskId: task.id,
        attempt: attempt.number,
        at: attempt.startedAt,
      })
      if (attempt.endedAt !== undefined)
        events.push({
          kind: 'finished',
          taskId: task.id,
          attempt: attempt.number,
          at: attempt.endedAt,
        })
    }
    // A recorded landing time wins over the worker end time: time-to-merge
    // measures review to landing, not work to worker finish. The recorded
    // log already carries it, so the fallback only fires without one.
    const mergedAt =
      task.state === 'merged' && !landedAt.has(task.id) ? task.attempts.at(-1)?.endedAt : undefined
    if (mergedAt !== undefined)
      events.push({
        kind: 'landed',
        workspaceId: board.workspaceId,
        taskId: task.id,
        attempt: task.currentAttempt,
        at: mergedAt,
      })
    if (task.state === 'blocked' && task.blockedReason !== undefined)
      events.push({
        kind: 'blocked',
        workspaceId: board.workspaceId,
        taskId: task.id,
        attempt: task.currentAttempt,
        at: now,
        reason: task.blockedReason,
      })
  }
  return trafficMetrics(
    {
      tasks: board.tasks.map((task) => {
        const mergedAt = task.state === 'merged' ? task.attempts.at(-1)?.endedAt : undefined
        return {
          id: task.id,
          roleId: task.roleId,
          createdAt: task.createdAt,
          writing: (task.writes?.length ?? 0) > 0,
          ...(mergedAt !== undefined && { mergedAt }),
          attempts: task.attempts,
        }
      }),
      events,
      slots: [],
    },
    { period: 'allTime' },
    now,
  )
}

/** Projection contains only actions this window can actually honor. */
/** A refusal reason in its own technical words: the kind, the holder or branch
where there is one, and the offered rebuild/recheck action. */
function describeMergeRefusal(refusal: TeamMergeRefusal): string {
  switch (refusal.kind) {
    case 'stale': {
      return 'stale (rebuild)'
    }
    case 'busy': {
      return 'busy (recheck)'
    }
    case 'denied': {
      return 'denied'
    }
    case 'branched': {
      const where = refusal.branch ?? 'unknown'
      return refusal.holder === undefined
        ? `branched (${where})`
        : `branched (${where}) held by ${JSON.stringify(refusal.holder)}`
    }
  }
}
/** One returned row: a recorded refusal with its reason and its action. */
function returnedRow(
  taskId: string,
  position: number,
  generation: number,
  refusal: TeamMergeRefusal,
  isLandable: boolean,
): TrafficSlice['mergeQueue'][number] {
  return {
    taskId,
    position,
    generation,
    reason: describeMergeRefusal(refusal),
    state: 'returned',
    flaky: false,
    ...(refusal.kind === 'branched' &&
      refusal.branch !== undefined && { landingBranch: refusal.branch }),
    actions: isLandable ? ['landNow'] : [],
  }
}

/** The Traffic queue rows: the ordered waiting queue first, then done tasks
whose recorded refusal outlived their turn. A returned turn leaves the queue
so the next task can land, but its refusal stays visible with its reason. */
function mergeQueueRows(board: TeamBoard, service: TeamHostService) {
  const waiting = service.mergeQueue?.() ?? []
  const queued = new Set(waiting.map((row) => row.taskId))
  const isPaused = service.landingPaused()
  const rows: TrafficSlice['mergeQueue'] = []
  for (const row of waiting) {
    const boardTask = board.tasks.find((task) => task.id === row.taskId)
    if (boardTask === undefined) continue
    const refusal = service.mergeRefusal?.(row.taskId)
    const isLandable =
      !isPaused && row.position === 1 && (refusal === undefined || refusal.action !== undefined)
    if (refusal === undefined) {
      const waitingRow: TrafficSlice['mergeQueue'][number] = {
        taskId: row.taskId,
        position: row.position,
        generation: boardTask.currentAttempt,
        reason: UI_TEXT.teamTraffic.waitingApproval,
        state: 'waiting',
        flaky: false,
        actions: isLandable ? ['landNow'] : [],
      }
      rows.push(waitingRow)
    } else {
      rows.push(
        returnedRow(row.taskId, row.position, boardTask.currentAttempt, refusal, isLandable),
      )
    }
  }
  const refused = board.tasks.filter(
    (task) => task.state === 'review' && !queued.has(task.id) && service.mergeRefusal?.(task.id),
  )
  for (const [index, task] of refused.entries()) {
    const refusal = service.mergeRefusal?.(task.id)
    if (refusal === undefined) continue
    const position = waiting.length + index + 1
    rows.push(
      returnedRow(
        task.id,
        position,
        task.currentAttempt,
        refusal,
        !isPaused && position === 1 && refusal.action !== undefined,
      ),
    )
  }
  return rows
}

export function projectTeamTraffic(
  service: TeamHostService,
  cap: number,
  hints: readonly WindowHint[] = [],
  sharedFiles: readonly TeamSharedFile[] = [],
  windowInstanceId = '',
): TrafficSlice {
  const board = service.scheduler?.snapshot()
  if (board === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
  const active = board.tasks.filter((task) =>
    task.attempts.some((attempt) => attempt.state !== 'retired'),
  )
  const tree = service.tree()
  const entries =
    tree?.roles.flatMap((role) =>
      role.entries.map((entry) => ({
        id: entry.id,
        generation: 0,
        roleId: role.id,
        label: entry.model ?? entry.id,
      })),
    ) ?? []
  return trafficSliceSchema.parse({
    board,
    ranks: [],
    entries,
    taskActions: board.tasks.map((task) => {
      let actions: string[] = []
      let reason: string | undefined
      if (task.state === 'queued' || task.state === 'ready')
        actions = ['cancel', 'priority', task.held ? 'release' : 'hold']
      else if (task.state === 'running') actions = ['cancel', 'reassign']
      else if (
        task.state === 'blocked' &&
        task.attempts.some((attempt) => attempt.state === 'uncertain')
      ) {
        // The retirement card: proof failed, so the person's recorded
        // decision is the only way forward (PLAN M96c acceptance 9).
        actions = ['handOffAnyway', 'continueAnyway', 'restartTeamHost', 'cancel']
        reason = task.blockedReason ?? UI_TEXT.teamTrafficNotices.uncertainAttempt
      }
      return {
        taskId: task.id,
        attempt: task.currentAttempt,
        generation: task.currentAttempt,
        actions,
        ...(reason !== undefined && { reason }),
      }
    }),
    lanes: [
      {
        id: 'workers',
        label: UI_TEXT.teamTraffic.lanes,
        scope: 'workers',
        busy: active.length,
        capacity: cap,
      },
    ],
    hostBusy: false,
    writeLeases: service.scheduler?.writeLeases() ?? [],
    resources: [],
    windows: hints.map((hint) => ({
      windowInstanceId: hint.instanceId,
      workspace: hint.workspaceName,
      branches: hint.trees.map((tree) => tree.branch),
      paths: hint.trees.flatMap((tree) => tree.paths),
      servers: hint.exclusiveServers,
      fresh: true,
      workers: hint.workers,
      processWorkers: hint.processWorkers,
      heavyCommands: hint.heavyCommands,
    })),
    localWorkers: active.length,
    workerCap: cap,
    recovery: recoverInterrupted(board, tree, windowInstanceId),
    conflicts: predictConflicts(board, sharedFiles),
    mergeQueue: mergeQueueRows(board, service),
    mergePaused: service.landingPaused(),
    copies: [],
    metrics: [summarizeMetrics(board, service.mergeEvents?.() ?? [])],
    announcements: board.tasks
      .filter((task) => task.state === 'merged')
      .map((task) => ({ id: task.id, kind: 'landed', taskId: task.id })),
  })
}
