// What the conversations see of turn checkpoints (M72, M86; PLAN.md D51,
// D63): one store per window over the first workspace folder. A turn of the
// Model API backend records its unit (and its tools' writes, writeRecorder.ts)
// only while the workspace is trusted, git is on PATH and
// `museSpark.turnCheckpoints` is on; a child turn records when its top turn
// does. Restricted Mode runs no git (D24), so it has none, and the panel says
// so; so does a window with no folder, no git or the setting off. What is
// already under way still finishes with the setting off (a unit's end, a
// Redo), and cleanup runs whatever the posture: an archived conversation's
// records go at once when git may run, and at the next trusted opening
// otherwise.

import type { FileReservation, ShellResult, ToolIo } from '../../core/backends/modelapi/tools'
import { refusedShellEntry, ShellEntryError } from '../../core/shellResult'
import { randomUUID } from 'node:crypto'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { Owner } from '../../core/checkpoints/toolWrites'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  type CheckpointAvailability,
  MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { turnKey } from '../../core/checkpoints/turnKey'
import { isBelow } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import type {
  CheckpointStore,
  RedoRequest,
  RestoreOutcome,
  RestoreRequest,
} from './checkpointStore'

export interface CheckpointPort {
  /** Native uncertainty persists independently of the recording setting. */
  isNativeUnsafe(): boolean
  markNativeBackend(): Promise<void>
  markUnprovenProcess(): Promise<void>
  availability(): CheckpointAvailability
  /**
   * A turn (or a message about to start one) begins or stops running in the
   * window, published at once with no lock or git: no restore runs meanwhile,
   * here or in another current window in the canonical-root storage namespace.
   */
  markTurn(key: string, isRunning: boolean): Promise<void>
  /**
   * Withdraws a running mark and never throws: a failed write is logged, and
   * the presence is written again soon without the mark.
   */
  withdrawMark(key: string): Promise<void>
  /**
   * A turn's unit starts: its record is made before any of its writes. The
   * owner its writes are recorded under; undefined while checkpoints are not
   * on, unless `isInherited` (a child turn whose top turn records).
   */
  startTurnUnit(sessionId: string, turnId: string, isInherited: boolean): Promise<Owner | undefined>
  /** A unit ended (its owner io drained): folded and sealed, whatever the setting. */
  endUnit(owner: Owner, end: { readonly ranProcesses: boolean }): Promise<void>
  turns(sessionId: string): Promise<readonly string[]>
  legacyTurns(sessionId: string): Promise<readonly string[]>
  restore(request: RestoreRequest): Promise<RestoreOutcome>
  redo(request: RedoRequest): Promise<RestoreOutcome>
  forgetSession(sessionId: string): Promise<void>
  /** The conversation was unarchived: its archives go, whatever the setting. */
  unforgetSession(sessionId: string): Promise<void>
  /** The window opened or was trusted: recovery, cleanup and retention, whatever the setting. */
  maintain(): Promise<void>
  /**
   * Refuses a tool's write into the checkpoint storage of any namespace,
   * whatever the setting: a filter planted in the repository's configuration
   * would run as the user.
   */
  refuseStorageWrite(absolutePath: string): void
}

/** What the port uses of the store. */
export type CheckpointStoreApi = Pick<
  CheckpointStore,
  | 'instance'
  | 'startUnit'
  | 'endUnit'
  | 'markTurn'
  | 'turns'
  | 'legacyTurns'
  | 'restore'
  | 'redo'
  | 'forgetSession'
  | 'unforgetSession'
  | 'queueForget'
  | 'maintain'
  | 'isStoragePath'
  | 'isNativeUnsafe'
  | 'markNativeBackend'
  | 'markUnprovenProcess'
>

export interface CheckpointHostDeps {
  readonly isNamespaceKnown: () => boolean
  /** The turns a retired implementation recorded in the workspace's own storage. */
  readonly legacyTurns?: (sessionId: string) => Promise<readonly string[]>
  readonly onAvailabilityChanged?: () => void
  /** Undefined without a confirmed canonical first-folder namespace. */
  readonly store: CheckpointStoreApi | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly isEnabled: () => boolean
  /** Whether git is on the absolute entries of PATH (D24). */
  readonly hasGit: () => boolean
  readonly log: Logger
}

const UNAVAILABLE: RestoreOutcome = { ok: false, reason: 'unavailable' }
const UNSUPPORTED: RestoreOutcome = { ok: false, reason: 'backendUnsupported' }

export function createCheckpointPort(deps: CheckpointHostDeps): CheckpointPort {
  const backendOf = (request: RestoreRequest | RedoRequest) =>
    deps.isWorkspaceTrusted() && deps.store?.isNativeUnsafe !== true
      ? request.backend?.()
      : undefined
  const availability = (): CheckpointAvailability => {
    if (deps.store === undefined || !deps.isNamespaceKnown()) {
      return 'noFolder'
    }
    if (!deps.isWorkspaceTrusted()) {
      return 'restricted'
    }
    if (!deps.hasGit()) {
      return 'noGit'
    }
    return deps.isEnabled() ? 'on' : 'off'
  }
  /** The store while new units are recorded and offered. */
  const onStore = (): CheckpointStoreApi | undefined =>
    availability() === 'on' ? deps.store : undefined
  /** The store while git may run, whatever the setting. */
  const gitStore = (): CheckpointStoreApi | undefined => {
    const posture = availability()
    return posture === 'on' || posture === 'off' ? deps.store : undefined
  }
  const markTurn = async (key: string, isRunning: boolean): Promise<void> => {
    if (isRunning && !deps.isNamespaceKnown()) {
      throw new Error(UI_TEXT.checkpointsNativeUnsafe)
    }
    try {
      await deps.store?.markTurn(key, isRunning, gitStore() !== undefined)
    } finally {
      if (key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) {
        deps.onAvailabilityChanged?.()
      }
    }
  }
  return {
    isNativeUnsafe: () => deps.store?.isNativeUnsafe === true,
    markNativeBackend: async () => {
      if (!deps.isNamespaceKnown()) {
        throw new Error(UI_TEXT.checkpointsNativeUnsafe)
      }
      try {
        await deps.store?.markNativeBackend()
      } finally {
        deps.onAvailabilityChanged?.()
      }
    },
    markUnprovenProcess: async () => {
      if (!deps.isNamespaceKnown()) {
        throw new Error(UI_TEXT.checkpointsNativeUnsafe)
      }
      try {
        await deps.store?.markUnprovenProcess()
      } finally {
        deps.onAvailabilityChanged?.()
      }
    },
    availability,
    markTurn,
    withdrawMark: async (key) => {
      try {
        await markTurn(key, false)
      } catch (error: unknown) {
        deps.log.warn(`A running mark was not withdrawn yet: ${failureForLog(error)}`)
      }
    },
    startTurnUnit: async (sessionId, turnId, isInherited) => {
      const store = isInherited ? gitStore() : onStore()
      if (store === undefined) {
        return
      }
      const owner: Owner = { instance: store.instance, sessionId, unitKind: 'turn', unitId: turnId }
      await store.startUnit(owner)
      return owner
    },
    endUnit: async (owner, end) => {
      await gitStore()?.endUnit(owner, end)
    },
    turns: async (sessionId) => (await onStore()?.turns(sessionId)) ?? [],
    legacyTurns: async (sessionId) => {
      const store = onStore()
      if (store === undefined) {
        return []
      }
      const older = (await deps.legacyTurns?.(sessionId)) ?? []
      return [...new Set([...older, ...(await store.legacyTurns(sessionId))])]
    },
    restore: async (request) => {
      if (request.backend?.() !== 'modelApi') {
        return UNSUPPORTED
      }
      if (deps.store?.isNativeUnsafe === true) {
        return { ok: false, reason: 'nativeUnsafe' }
      }
      return (
        (await onStore()?.restore({
          ...request,
          backend: () => backendOf(request),
        })) ?? UNAVAILABLE
      )
    },
    redo: async (request) => {
      if (request.backend?.() !== 'modelApi') {
        return UNSUPPORTED
      }
      if (deps.store?.isNativeUnsafe === true) {
        return { ok: false, reason: 'nativeUnsafe' }
      }
      return (
        (await gitStore()?.redo({
          ...request,
          backend: () => backendOf(request),
        })) ?? UNAVAILABLE
      )
    },
    forgetSession: async (sessionId) => {
      const store = gitStore()
      await (store === undefined
        ? deps.store?.queueForget(sessionId)
        : store.forgetSession(sessionId))
    },
    unforgetSession: async (sessionId) => {
      await deps.store?.unforgetSession(sessionId)
    },
    maintain: async () => {
      await gitStore()?.maintain()
    },
    refuseStorageWrite: (absolutePath) => {
      if (deps.store?.isStoragePath(absolutePath) === true) {
        throw new Error(MODEL_TEXT.checkpointStorageWrite)
      }
    },
  }
}

/** Whether a turn records its unit, and the owner its writes are recorded under. */
export type TurnRecording =
  | { readonly kind: 'recording'; readonly owner: Owner }
  /** Checkpoints are not on: the turn records nothing (a range holding it is refused). */
  | { readonly kind: 'off' }
  /** Its record could not be made: a child turn in this state must not run (spec 3.2). */
  | { readonly kind: 'failed' }

/**
 * A Model API turn (or child turn) is about to run: it is published as
 * running, then its unit's record is made, before hooks or edits (queued and
 * scheduled turns included). A child turn passes its top turn's decision
 * (`isInherited`), so it records even if the setting went off meanwhile.
 */
export async function prepareCheckpointTurn(
  port: CheckpointPort,
  sessionId: string,
  turnId: string,
  log: Logger,
  isInherited = false,
): Promise<TurnRecording> {
  await port.markTurn(turnKey(sessionId, turnId), true)
  try {
    const owner = await port.startTurnUnit(sessionId, turnId, isInherited)
    return owner === undefined ? { kind: 'off' } : { kind: 'recording', owner }
  } catch (error: unknown) {
    log.warn(`No turn record was made: ${failureForLog(error)}`)
    return { kind: 'failed' }
  }
}

/**
 * A Model API turn ended (its owner io drained, Stop and cancellation alike):
 * its unit folded and sealed when it recorded, and only then its running mark
 * withdrawn. A unit that could not be sealed keeps the mark until it is.
 */
export async function finishCheckpointTurn(
  port: CheckpointPort,
  sessionId: string,
  turnId: string,
  recording: TurnRecording,
  end: { readonly ranProcesses: boolean },
): Promise<void> {
  if (recording.kind === 'recording') {
    await port.endUnit(recording.owner, end)
  }
  await port.markTurn(turnKey(sessionId, turnId), false)
}

/**
 * An explicit local file edit owns admission until its actual I/O settles.
 * Withdrawing the lease afterwards never fails the edit: a failure is logged
 * (CC-M9c), and the window stays fenced until its presence is written again.
 */
export async function withCheckpointEdit<T>(
  checkpoints: CheckpointPort,
  check: () => void,
  work: () => Promise<T>,
): Promise<T> {
  const key = `${CHECKPOINT_ACTIVITY_PREFIX}${randomUUID()}`
  check()
  try {
    await checkpoints.markTurn(key, true)
    check()
    return await work()
  } finally {
    await checkpoints.withdrawMark(key)
  }
}

/** The workspace folder a restore writes under, and the platform whose path rules compare with it. */
export interface EditWorkspace {
  readonly root: string | undefined
  /**
   * The folder as VS Code spells it, when that differs from the canonical root
   * (a link, a junction, a mapped drive). The store accepts both spellings, so
   * a path a save dialog returns in either one is inside.
   */
  readonly displayRoot?: string | undefined
  readonly platform: NodeJS.Platform
}

/**
 * An explicit edit of `absolutePath`, which may lie outside the workspace
 * folder: inside it the pure lease is held until `work` settles; outside it
 * (a personal data folder, a file the user exports elsewhere) or with no
 * path no restore writes, so only the guard speaks, before the work starts.
 */
export async function withCheckpointEditAt<T>(
  checkpoints: CheckpointPort,
  check: () => void,
  workspace: EditWorkspace,
  absolutePath: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const p = pathModule(workspace.platform)
  const isInside =
    absolutePath !== undefined &&
    [workspace.root, workspace.displayRoot].some(
      (root) => root !== undefined && isBelow(p.relative(root, absolutePath), p),
    )
  if (!isInside) {
    check()
    return await work()
  }
  return await withCheckpointEdit(checkpoints, check, work)
}

/**
 * The tools' file access, window-wide: a write into the checkpoint storage is
 * refused whatever the setting, and every shell or hook holds an activity
 * mark while it runs. It records nothing: a turn's writes are recorded by its
 * own owner-bound io (writeRecorder.ts).
 */
export function withCheckpointCopies(io: ToolIo, checkpoints: CheckpointPort): ToolIo {
  const finishActivity = async (key: string, isProven: boolean): Promise<void> => {
    try {
      if (!isProven) {
        await checkpoints.markUnprovenProcess()
      }
      await checkpoints.markTurn(key, false)
    } catch (error: unknown) {
      throw new Error(UI_TEXT.checkpointFailed, { cause: error })
    }
  }
  const activity = async (
    work: () => Promise<ShellResult>,
    assertCanRun?: () => void,
  ): Promise<ShellResult> => {
    const key = `${CHECKPOINT_ACTIVITY_PREFIX}${randomUUID()}`
    try {
      await checkpoints.markTurn(key, true)
    } catch (error: unknown) {
      try {
        await checkpoints.markTurn(key, false)
      } catch {
        // No work started; an uncertain mark remains closed to restores.
      }
      throw new ShellEntryError(UI_TEXT.checkpointFailed, { cause: error })
    }
    try {
      assertCanRun?.()
    } catch {
      await finishActivity(key, true)
      return refusedShellEntry()
    }
    let result: ShellResult
    try {
      result = await work()
    } catch (error: unknown) {
      await finishActivity(key, false)
      throw error
    }
    await finishActivity(key, result.isWorkspaceShutdownProven === true)
    return result
  }
  const hook = io.runHook?.bind(io)
  const conditionalWrite = io.writeFileIfUnchanged.bind(io)
  return {
    ...io,
    runShell: async (command, cwd, timeoutMs, signal, limit, assertCanRun) =>
      await activity(
        async () => await io.runShell(command, cwd, timeoutMs, signal, limit, assertCanRun),
        assertCanRun,
      ),
    ...(hook !== undefined && {
      runHook: async (...args: Parameters<NonNullable<ToolIo['runHook']>>) =>
        await activity(async () => await hook(...args)),
    }),
    writeFile: async (absolutePath, content, expectedCanonicalPath, assertCanWrite) => {
      checkpoints.refuseStorageWrite(absolutePath)
      await io.writeFile(absolutePath, content, expectedCanonicalPath, assertCanWrite)
    },
    writeFileIfUnchanged: async (...args: Parameters<ToolIo['writeFileIfUnchanged']>) => {
      checkpoints.refuseStorageWrite(args[0])
      return await conditionalWrite(...args)
    },
    reserveFile: async (absolutePath, expectedCanonicalPath): Promise<FileReservation> => {
      checkpoints.refuseStorageWrite(absolutePath)
      return await io.reserveFile(absolutePath, expectedCanonicalPath)
    },
  }
}
