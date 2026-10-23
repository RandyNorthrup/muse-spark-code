import { TEAM_SIZE_MINUTES, UI_TEXT } from '../../../shared/constants'
import { Usd } from '../../../shared/usd'
import {
  teamBoardSchema,
  teamBoardTaskSchema,
  type TeamBoardOwner,
  type TeamBoardTask,
  type TeamSchedulerFields,
} from '../../../shared/team'
import type { TeamSchedulingDeps, TeamSchedulingPort } from '../teamScheduling'
import { TaskBoard } from './board'
import { SchedulerSlots, isResourceSlotAvailable, type SlotRequest } from './slots'
import { AttemptRetirement } from './retire'
import { StallRecovery, type HandoffEntry } from './stalls'
import { TeamScheduler } from '../teamPool'
import { teamPathMatcher } from '../sharedFiles'
import { WriteSetLeases, expandWriteSet, writeSetOverlap, type PlannedWriteSet } from '../writeSets'
import { SharedFiles } from '../sharedFiles'

export const TEAM_BOARD_STATE_KEY = 'museSpark.team.board'
const ARCHIVE_KEY = 'museSpark.team.boardArchive'
const DECISIONS_KEY = 'museSpark.team.retirementDecisions'

/** One instance for the workspace-holding window; effects begin on submission. */
export function createWindowTeamScheduler(deps: TeamSchedulingDeps): TeamSchedulingPort {
  const archive = new Map<string, TeamBoardTask>()
  const storedArchive = deps.state.get(ARCHIVE_KEY)
  if (Array.isArray(storedArchive)) {
    for (const raw of storedArchive) {
      const task = teamBoardTaskSchema.parse(raw)
      archive.set(task.id, task)
    }
  }
  const entries = () => deps.entries()
  const board = new TaskBoard(deps.workspaceId, deps.windowInstanceId, {
    workspaceFor: (id) => archive.get(id)?.workspaceId,
    workspaceMode: deps.mode,
    report: deps.report,
    countAttempt: (task, attempt) => {
      const entry = entries().find(
        (item) =>
          item.id === attempt.entryId &&
          item.modelId === attempt.modelId &&
          item.agentProfileId === attempt.agentProfileId,
      )
      return entry !== undefined && deps.admit(task, entry)
    },
    refundAttempt: (task) => {
      deps.refund(task.id)
    },
    archive: (tasks) => {
      for (const task of tasks) archive.set(task.id, structuredClone(task))
    },
    archivedTask: (id) => archive.get(id),
  })
  /** This window's birth and process lease for the board ownership claim. */
  const birth = {
    windowStartedAt: deps.ownerBirth?.windowStartedAt ?? deps.now(),
    ...(deps.ownerBirth?.pid !== undefined && { pid: deps.ownerBirth.pid }),
    ...(deps.ownerBirth?.processStart !== undefined && {
      processStart: deps.ownerBirth.processStart,
    }),
  }
  /** Classify the stored claim without IO: mine, free, provably live, or needing proof. */
  const classifyOwner = (
    stored: TeamBoardOwner | undefined,
  ): 'free' | 'mine' | 'live' | 'needsProof' => {
    if (stored === undefined || stored.released) return 'free'
    if (stored.windowInstanceId === deps.windowInstanceId) return 'mine'
    const isSameBirth =
      stored.pid !== undefined &&
      birth.pid !== undefined &&
      stored.pid === birth.pid &&
      stored.processStart !== undefined &&
      stored.processStart === birth.processStart
    return isSameBirth ? 'live' : 'needsProof'
  }
  const readStoredOwner = (): TeamBoardOwner | undefined => {
    const parsed = teamBoardSchema.safeParse(deps.state.get(TEAM_BOARD_STATE_KEY))
    return parsed.success ? (parsed.data.owner ?? undefined) : undefined
  }
  /** True only when the owner is proven gone: same-process life, the probe,
  or nothing provable (which fails closed). */
  const isOwnerGone = async (stored: TeamBoardOwner): Promise<boolean> => {
    const verdict = classifyOwner(stored)
    if (['free', 'mine', 'live'].includes(verdict) || deps.probeOwner === undefined) return false
    const proof = await deps.probeOwner(stored)
    return proof === false
  }
  let shared = new SharedFiles([], deps.sharedFiles?.() ?? [])
  const sharedFiles = (): SharedFiles => shared
  let leases = new WriteSetLeases(deps.workspaceId, shared)
  const reducedCaps = new Map<string, number>()
  const slots = new SchedulerSlots(deps.workspaceId, () => {
    const limits = deps.limits()
    return {
      ...limits,
      agent: (id) => Math.min(limits.agent(id), reducedCaps.get(id) ?? limits.agent(id)),
    }
  })
  // A recovered attempt keeps its write-set lease as well as its slot: with a
  // free slot but no lease, Resume could dispatch an overlapping writer
  // before the interrupted attempt retires.
  const writeSetOf = (task: TeamBoardTask): PlannedWriteSet =>
    expandWriteSet(deps.mode(task.id) === 'read-only' ? [] : (task.writes ?? []), [])
  /**
  One release closure for new and restored write leases alike: the
  scheduler's single release table owns both, so retirement releases a
  recovered lease exactly like a fresh one.
  */
  const writeLeaseRelease = (taskId: string, attemptNumber: number) => (): void => {
    const holder = { taskId, attempt: attemptNumber }
    const current = board.task(taskId)
    const attempt = current.attempts.find((item) => item.number === attemptNumber)
    if (attempt === undefined) leases.withdraw(holder)
    else if (attempt.retirement !== undefined) leases.release(holder, attempt.retirement)
  }
  /** Restored leases, adopted into the scheduler's release table once built. */
  const adopted: { taskId: string; attempt: number; release: () => void }[] = []
  const stored = deps.state.get(TEAM_BOARD_STATE_KEY)
  if (stored !== undefined) {
    board.restore(stored)
    for (const task of board.snapshot().tasks) {
      for (const attempt of task.attempts) {
        if (attempt.state === 'retired') continue
        slots.recover({
          taskId: task.id,
          attempt: attempt.number,
          workspaceId: task.workspaceId,
          roleId: task.roleId,
          entryId: attempt.entryId,
          agentProfileId: attempt.agentProfileId,
          kind: attempt.kind,
        })
        const acquired = leases.acquire(
          { taskId: task.id, attempt: attempt.number },
          writeSetOf(task),
          task.overlap,
        )
        if (acquired.kind === 'acquired')
          adopted.push({
            taskId: task.id,
            attempt: attempt.number,
            release: writeLeaseRelease(task.id, attempt.number),
          })
      }
    }
  }
  let writes = Promise.resolve()
  let failure: Error | undefined
  const save = async (): Promise<void> => {
    if (failure !== undefined) throw failure
    const snapshot = board.snapshot()
    const archived = Array.from(archive.values(), (task) => structuredClone(task))
    const previous = writes
    writes = (async () => {
      try {
        await previous
        await deps.state.update(ARCHIVE_KEY, archived)
        await deps.state.update(TEAM_BOARD_STATE_KEY, snapshot)
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new Error(UI_TEXT.teamBudgetUnavailable, { cause: error })
        throw failure
      }
    })()
    await writes
    deps.changed()
  }
  /**
  Take a free or proven-gone ownership claim then prove it by re-reading:
  a live or unprovable foreign owner refuses. Shared by the launch gate's
  compare-and-set and by explicit takeover.
  */
  const didClaimOwnership = async (): Promise<boolean> => {
    const stored = readStoredOwner()
    if (stored !== undefined) {
      const verdict = classifyOwner(stored)
      if (verdict === 'mine') return true
      if (verdict === 'live') return false
      if (verdict === 'needsProof' && !(await isOwnerGone(stored))) return false
    }
    board.takeOwnership(birth)
    await save()
    const reread = readStoredOwner()
    return reread?.windowInstanceId === deps.windowInstanceId && !reread.released
  }
  const canStart = (task: TeamBoardTask, entry: ReturnType<typeof entries>[number]) =>
    failure === undefined &&
    deps.canStart(task, entry) &&
    (deps.capacity === undefined || isResourceSlotAvailable(deps.capacity, 'worker'))
  const scheduler = new TeamScheduler(board, slots, {
    now: deps.now,
    context: () => {
      const snapshot = board.snapshot()
      const held = leases.snapshot()
      const isSatisfied = (depId: string, on: string | undefined): boolean => {
        const dep = snapshot.tasks.find((candidate) => candidate.id === depId)
        if (dep === undefined) return false
        return on === 'merged'
          ? dep.state === 'merged'
          : dep.state === 'done' || dep.state === 'merged'
      }
      // Waiter -> holder edges from live runtime state: unmet dependencies,
      // lease contention against held write sets, and the merge lane.
      const waits: { waiter: string; holder: string }[] = []
      for (const task of snapshot.tasks) {
        if (task.state !== 'queued' && task.state !== 'ready' && task.state !== 'blocked') continue
        const edges = task.depends_on ?? []
        for (const edge of edges)
          if (!isSatisfied(edge.task, edge.on)) waits.push({ waiter: task.id, holder: edge.task })
        if (task.state !== 'ready') continue
        const set = writeSetOf(task)
        if (set.patterns.length === 0 && !set.exclusiveWriter) continue
        const hasPathOverlap = (paths: readonly string[]): boolean =>
          set.exclusiveWriter
            ? paths.length > 0
            : paths.some((path) =>
                set.patterns.some((pattern) =>
                  teamPathMatcher(pattern, set.isCaseInsensitive)(path),
                ),
              )
        for (const lease of held) {
          if (lease.holder.taskId === task.id) continue
          if (lease.exclusiveWriter || hasPathOverlap(lease.paths))
            waits.push({ waiter: task.id, holder: lease.holder.taskId })
        }
        for (const other of snapshot.tasks) {
          if (other.id === task.id) continue
          if (other.state !== 'review' && other.state !== 'merge') continue
          if (writeSetOverlap(set, writeSetOf(other), sharedFiles()).length > 0)
            waits.push({ waiter: task.id, holder: other.id })
        }
      }
      const hasLandingOverlap = (task: TeamBoardTask): boolean => {
        const set = writeSetOf(task)
        return snapshot.tasks.some(
          (other) =>
            other.id !== task.id &&
            (other.state === 'review' || other.state === 'merge') &&
            writeSetOverlap(set, writeSetOf(other), sharedFiles()).length > 0,
        )
      }
      return {
        now: deps.now(),
        entries: entries(),
        canStart,
        estimatedTokens: () => 1,
        minutes: (task) => TEAM_SIZE_MINUTES[task.size],
        landingOverlap: hasLandingOverlap,
        waits,
        youngerStarted: (task) => {
          const readyAt = task.readyAt
          return (
            readyAt !== undefined &&
            snapshot.tasks.some(
              (other) =>
                other.id !== task.id &&
                (other.readyAt ?? Number.MAX_SAFE_INTEGER) > readyAt &&
                other.attempts.some((attempt) => attempt.startedAt >= readyAt),
            )
          )
        },
        conversationWeight: () => 1,
      }
    },
    // Zero worker capacity routes ready tasks through the exhausted policy
    // instead of queueing them silently.
    headroom: () =>
      deps.capacity === undefined || isResourceSlotAvailable(deps.capacity, 'worker')
        ? 'lane'
        : 'exhausted',
    exhausted: deps.changed,
    lease: (task, ref) => {
      const holder = { taskId: task.id, attempt: ref.attempt }
      // Undeclared write sets lease nothing: only declared writes serialize.
      const acquired = leases.acquire(holder, writeSetOf(task), task.overlap)
      if (acquired.kind !== 'acquired') return
      return { release: writeLeaseRelease(task.id, ref.attempt) }
    },
    // One owner per board: a window that does not hold the claim (and cannot
    // take it over) authorizes nothing, so two windows reading the same state
    // cannot both start attempt 1.
    authorize: async (task, entry) =>
      board.holdsOwnership(birth) && (await deps.authorize(task, entry)),
    // The durable compare-and-set after the launch journal: the stored board
    // must still name this window. A free or proven-gone claim is taken here
    // (claimed, journalled, re-read); a live or unprovable foreign owner
    // refuses, and the reservation closes without launching.
    verifyOwnership: () => didClaimOwnership(),
    journal: save,
    start: async (task, entry, input) => {
      // Final admission gate: governor capacity may have moved during
      // authorize and the durable journal writes. Entry headroom is not
      // rechecked here: this reservation already holds its own slot, so a
      // headroom check would count the reservation against itself. A refused
      // reservation closes without launching a worker.
      // Post-begin expectations: the reservation already moved this attempt
      // to running. Anything else (or a failed journal, or lost capacity)
      // means the world moved during authorize/journal: close, don't launch.
      // The capacity recheck excludes this reservation's own slot, like the
      // acquisition check: without that the attempt counts itself and a
      // single-worker workspace refuses every launch.
      if (failure !== undefined) return 'notStarted'
      const current = board.task(task.id)
      // A pause during the authorize or journal awaits means no launch. The
      // unstarted admission is refunded, not stranded uncertain: its worker
      // was never invoked.
      if (board.paused) {
        try {
          board.cancelUnstarted(task.id, task.currentAttempt)
          await save()
        } catch {
          // Not a refundable admission; the scheduler marks it uncertain below.
        }
        return 'notStarted'
      }
      if (
        current.state !== 'running' ||
        current.currentAttempt !== task.currentAttempt ||
        current.attempts.at(-1)?.state !== 'running' ||
        (deps.capacity !== undefined && !isResourceSlotAvailable(deps.capacity, 'worker', true))
      )
        return 'notStarted'
      try {
        await deps.launch(task, entry, input)
      } catch (error: unknown) {
        // A final-admission refusal precedes the worker too: refund it. Any
        // other launch failure keeps the scheduler's uncertain liability.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'teamFinalAdmissionRefused'
        ) {
          try {
            board.cancelUnstarted(task.id, task.currentAttempt)
            await save()
          } catch {
            // Not refundable after all; uncertain below.
          }
          return 'notStarted'
        }
        throw error
      }
      return 'started'
    },
    uncertain: async () => {
      await save()
    },
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    failure: (error) => {
      deps.failure(error)
    },
    halveAgentCap: (id) => {
      reducedCaps.set(
        id,
        Math.max(1, Math.floor((reducedCaps.get(id) ?? deps.limits().agent(id)) / 2)),
      )
      deps.changed()
    },
    ...(deps.onStallDetected !== undefined && { onStallDetected: deps.onStallDetected }),
  })
  // Restored write leases join the same release table new reservations use.
  for (const lease of adopted) scheduler.adoptLease(lease, { release: lease.release })

  /**
  Attempt retirement and stall recovery (M96c): the board, slots and leases
  live here; evidence and effects on real runs come through deps.retirement.
  Absent that port, every retirement action refuses with teamTaskUnknown.
  */
  const delay = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
  const retirementPort = deps.retirement
  const attemptRetirement =
    retirementPort === undefined
      ? undefined
      : new AttemptRetirement(
          {
            windowInstanceId: deps.windowInstanceId,
            now: deps.now,
            evidence: (ref) => retirementPort.evidence(ref),
            cancel: (ref) => retirementPort.cancel(ref),
            changed: (ref, signal) => retirementPort.changed(ref, signal),
            escalate: (ref) => retirementPort.escalate(ref),
            delay,
            markUncertain: (ref) => {
              board.finishAttempt(ref.taskId, ref.attempt, { state: 'uncertain' })
              board.transition(
                ref.taskId,
                ref.attempt,
                'blocked',
                deps.now(),
                UI_TEXT.teamTrafficNotices.uncertainAttempt,
              )
            },
            quarantine: async (ref) => {
              await retirementPort.quarantine(ref)
              await save()
            },
            canQuarantine: (ref) => retirementPort.canQuarantine(ref),
            prepareReplacement: async (ref, replacement) => {
              const checkpoint = await retirementPort.checkpoint(ref)
              if (
                !board.prepareNext(ref.taskId, ref.attempt, deps.now(), 'stall', true) ||
                !(await retirementPort.applyReplacement(ref, replacement.attempt, checkpoint))
              )
                return false
              await save()
              await scheduler.wake()
              return true
            },
            exclusiveResourcesFree: (replacement) => {
              const snapshot = board.snapshot()
              const own = snapshot.tasks.find((task) => task.id === replacement.taskId)
              if (own === undefined) return false
              const set = writeSetOf(own)
              return snapshot.tasks.every(
                (other) =>
                  other.id === replacement.taskId ||
                  other.attempts.every((attempt) => attempt.state === 'retired') ||
                  writeSetOverlap(set, writeSetOf(other), sharedFiles()).length === 0,
              )
            },
            teamHostWorkers: () =>
              board
                .snapshot()
                .tasks.filter((task) => task.attempts.at(-1)?.state === 'running')
                .map((task) => ({ taskId: task.id, attempt: task.currentAttempt })),
            restartTeamHost: () => retirementPort.restartWorkers(),
            recordDecision: async (ref, decision) => {
              const stored = deps.state.get(DECISIONS_KEY)
              const decisions: Record<string, unknown>[] = Array.isArray(stored)
                ? stored.filter(
                    (item): item is Record<string, unknown> =>
                      typeof item === 'object' && item !== null,
                  )
                : []
              decisions.push({
                taskId: ref.taskId,
                attempt: ref.attempt,
                decision,
                at: deps.now(),
              })
              await deps.state.update(DECISIONS_KEY, decisions)
            },
          },
          slots,
        )
  const handoffEntries = (task: TeamBoardTask, onlyEntryId?: string): HandoffEntry[] =>
    entries()
      .filter(
        (entry) =>
          entry.roleId === task.roleId && (onlyEntryId === undefined || entry.id === onlyEntryId),
      )
      .map((entry) => ({
        id: entry.id,
        agentProfileId: entry.agentProfileId,
        modelId: entry.modelId,
        isKey: retirementPort?.isKeyEntry(entry.id) ?? false,
        hasHeadroom: canStart({ ...task, state: 'ready' }, entry),
      }))
  const stallRecoveryFor = (
    task: TeamBoardTask,
    onlyEntryId?: string,
  ): StallRecovery | undefined =>
    retirementPort === undefined || attemptRetirement === undefined
      ? undefined
      : new StallRecovery({
          isCurrent: (ref) =>
            board.snapshot().tasks.find((item) => item.id === ref.taskId)?.currentAttempt ===
            ref.attempt,
          retire: (ref) => attemptRetirement.retire(ref),
          checkpoint: (ref) => retirementPort.checkpoint(ref),
          settleUsage: (ref) => retirementPort.settleUsage(ref),
          entries: () => handoffEntries(task, onlyEntryId),
          consent: (entry) =>
            retirementPort.consentEntry({ taskId: task.id, attempt: task.currentAttempt }, entry),
          reassign: async (ref, entry, handoff) => {
            if (
              !board.prepareNext(ref.taskId, ref.attempt, deps.now(), 'stall') ||
              !(await retirementPort.applyReassignment(ref, entry, handoff))
            )
              return false
            await save()
            await scheduler.wake()
            return true
          },
          switchRow: () => {
            deps.changed()
          },
          block: (ref, reason) => {
            board.transition(ref.taskId, ref.attempt, 'blocked', deps.now(), reason)
          },
        })
  const requireRetirement = (): AttemptRetirement => {
    if (attemptRetirement === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
    return attemptRetirement
  }
  return {
    submit: async (
      tasks: readonly {
        id: string
        sessionId: string
        roleId: string
        fields: TeamSchedulerFields
      }[],
    ) => {
      // First submission claims the board when no live owner holds it;
      // a live foreign owner keeps its claim (submission is not dispatch).
      board.holdsOwnership(birth)
      board.submit(
        tasks.map((task) => ({
          id: task.id,
          parentSessionId: task.sessionId,
          roleId: task.roleId,
          workspaceMode: deps.mode(task.id),
          fields: task.fields,
        })),
        deps.now(),
      )
      await save()
      scheduler.startSweep()
      await scheduler.wake()
    },
    wake: () => scheduler.wake(),
    pause: async () => {
      board.pause()
      await save()
    },
    resume: async () => {
      board.resume()
      await save()
      scheduler.startSweep()
      await scheduler.wake()
    },
    snapshot: () => board.snapshot(),
    finish: async (id, state, retirement) => {
      const task = board.task(id)
      const attempt = task.currentAttempt
      if (attempt === 0) {
        board.transition(id, 0, 'cancelled', deps.now())
        await save()
        return
      }
      if (task.attempts.at(-1)?.state === 'retired') return
      board.finishAttempt(id, attempt, { state: 'retired', endedAt: deps.now(), retirement })
      board.transition(
        id,
        attempt,
        state,
        deps.now(),
        state === 'blocked' ? UI_TEXT.teamTaskStates.blocked : undefined,
      )
      await scheduler.retired({ taskId: id, attempt })
    },
    usage: async (id, attempt, usage) => {
      if (
        !board.usage(id, attempt, {
          inputTokens: usage.input,
          cachedInputTokens: usage.cachedInput,
          outputTokens: usage.output,
          reasoningTokens: usage.reasoning,
          modelCalls: usage.modelCalls,
          costUsd: usage.costUsd ?? Usd.from(0).toAmount(),
          accuracy: usage.estimated ? 'estimated' : 'reported',
        })
      )
        throw new Error(UI_TEXT.teamTaskUnknown)
      // Every usage report is real activity for the stall detector.
      scheduler.noteActivity({ taskId: id, attempt })
      await save()
    },
    noteActivity: (ref) => {
      scheduler.noteActivity(ref)
    },
    landed: async (id, state) => {
      const task = board.task(id)
      if (task.state === 'review') board.transition(id, task.currentAttempt, 'merge', deps.now())
      if (!board.transition(id, task.currentAttempt, state, deps.now()))
        throw new Error(UI_TEXT.teamTaskBusy)
      await save()
      await scheduler.wake()
    },
    reschedule: async (input) => {
      board.reschedule(input, deps.now())
      await save()
      await scheduler.wake()
    },
    retry: async (id) => {
      const task = board.task(id)
      if (!board.prepareNext(id, task.currentAttempt, deps.now(), 'stall')) return false
      await save()
      await scheduler.wake()
      return true
    },
    reopenInterrupted: async (id) => {
      if (!board.reopenInterrupted(id, deps.now())) return false
      await save()
      return true
    },
    takeoverBoard: () => didClaimOwnership(),
    releaseOwnership: async () => {
      board.releaseOwnership()
      await save()
    },
    configureSharedFiles: async (files) => {
      if (
        board
          .snapshot()
          .tasks.some((task) => task.attempts.some((attempt) => attempt.state !== 'retired'))
      )
        throw new Error(UI_TEXT.teamTaskBusy)
      shared = new SharedFiles([], files)
      leases = new WriteSetLeases(deps.workspaceId, shared)
      await save()
    },
    writeLeases: () => leases.snapshot(),
    retireAttempt: async (taskId, attempt) => {
      const outcome = await requireRetirement().retire({ taskId, attempt })
      if (outcome.state === 'retired') {
        board.finishAttempt(taskId, attempt, {
          state: 'retired',
          endedAt: outcome.endedAt,
          retirement: outcome.retirement,
        })
        board.transition(taskId, attempt, 'cancelled', deps.now())
        await scheduler.retired({ taskId, attempt })
      } else await save()
      return outcome.state
    },
    continueAnyway: async (taskId, attempt) => {
      const outcome = await requireRetirement().continueAnyway({ taskId, attempt })
      if (outcome.state !== 'retired') throw new Error(UI_TEXT.teamTaskUnknown)
      board.finishAttempt(taskId, attempt, {
        state: 'retired',
        endedAt: outcome.endedAt,
        retirement: outcome.retirement,
      })
      await scheduler.retired({ taskId, attempt })
    },
    handOffAnyway: async (taskId, attempt, entryId) => {
      const task = board.task(taskId)
      const entry =
        entries().find((item) => item.id === entryId && item.roleId === task.roleId) ??
        entries().find((item) => item.roleId === task.roleId)
      if (entry === undefined) return false
      const replacement: SlotRequest = {
        taskId,
        attempt: attempt + 1,
        workspaceId: task.workspaceId,
        roleId: task.roleId,
        entryId: entry.id,
        agentProfileId: entry.agentProfileId,
        kind: entry.kind,
      }
      const isHandedOff = await requireRetirement().handOffAnyway({ taskId, attempt }, replacement)
      await save()
      if (isHandedOff) await scheduler.wake()
      return isHandedOff
    },
    restartTeamHost: async () => {
      const workers = board
        .snapshot()
        .tasks.filter((task) => task.attempts.at(-1)?.state === 'running')
        .map((task) => ({ taskId: task.id, attempt: task.currentAttempt }))
      const results = await requireRetirement().restartTeamHost(workers)
      for (const { ref, outcome } of results) {
        if (outcome.state !== 'retired') continue
        board.finishAttempt(ref.taskId, ref.attempt, {
          state: 'retired',
          endedAt: outcome.endedAt,
          retirement: outcome.retirement,
        })
        board.transition(ref.taskId, ref.attempt, 'cancelled', deps.now())
        await scheduler.retired(ref)
      }
      await save()
    },
    reassignAttempt: async (taskId, attempt, entryId) => {
      if (retirementPort === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
      const task = board.task(taskId)
      const recovery = stallRecoveryFor(task, entryId)
      if (recovery === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
      const brief = retirementPort.stallBrief({ taskId, attempt })
      const result = await recovery.recover(task, 'noProgress', {
        policy: 'reassign',
        brief: brief.brief,
        lastMessage: brief.lastMessage,
        toolCalls: brief.toolCalls,
      })
      await save()
      return result
    },
    dispose: () => {
      scheduler.stopSweep()
    },
  }
}
