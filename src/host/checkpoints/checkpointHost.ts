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

import type {
  ShellResult,
  ToolIo,
  TopTurn,
  TurnCheckpoint,
  TurnEnd,
} from '../../core/backends/modelapi/tools'
import { refusedShellEntry, ShellEntryError } from '../../core/shellResult'
import { windowsPathProblem } from '../../core/windowsPathSpelling'
import { randomUUID } from 'node:crypto'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { Owner } from '../../core/checkpoints/toolWrites'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import type { TurnRecorder } from './writeRecorder'
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
   * would run as the user. It records nothing (M86): a turn's own io does.
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
  | 'storagePathProblem'
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
}

const UNAVAILABLE: RestoreOutcome = { ok: false, reason: 'unavailable' }
const UNSUPPORTED: RestoreOutcome = { ok: false, reason: 'backendUnsupported' }
const OFF: TurnCheckpoint = { kind: 'off' }

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
  return {
    isNativeUnsafe: () => deps.store?.isNativeUnsafe === true,
    markNativeBackend: async () => {
      if (!deps.isNamespaceKnown()) {
        throw new Error(UI_TEXT.checkpointsNativeUnsafe)
      }
      try {
        await deps.store?.markNativeBackend(gitStore() !== undefined)
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
    markTurn: async (key, isRunning) => {
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
      const problem =
        deps.store === undefined
          ? windowsPathProblem(absolutePath, process.platform, absolutePath) === undefined
            ? undefined
            : UI_TEXT.windowsPathRefused
          : deps.store.storagePathProblem(absolutePath)
      if (problem !== undefined) throw new Error(problem)
    },
  }
}

/** Where turns get their own recorded writes (M86): the window's `TurnRecorder`. */
type TurnRecorderApi = Pick<TurnRecorder, 'start' | 'end'>

/**
 * A Model API turn (or child turn) is about to run: it is published as
 * running, then its unit's record is made, before hooks or edits (queued and
 * scheduled turns included), and its tools get their own writes, recorded
 * until it ends. A child turn inherits its top turn's decision (spec 3.2): it
 * records even if the setting went off meanwhile, and not at all when its top
 * turn does not; one whose record cannot be made does not run (a rejection).
 * With no recorder nothing is recorded.
 */
export async function prepareCheckpointTurn(
  port: CheckpointPort,
  recorder: TurnRecorderApi | undefined,
  sessionId: string,
  turnId: string,
  log: Logger,
  top?: TopTurn,
): Promise<TurnCheckpoint> {
  await port.markTurn(turnKey(sessionId, turnId), true)
  if (top?.checkpoint?.kind === 'off' || top?.recordsFiles === false) {
    return OFF
  }
  if (recorder === undefined) {
    if (top !== undefined) {
      throw new Error(UI_TEXT.childCheckpointFailed)
    }
    return OFF
  }
  if (top !== undefined && top.checkpoint === undefined && top.recordsFiles === undefined) {
    throw new Error(UI_TEXT.childCheckpointFailed)
  }
  let owner: Owner | undefined
  try {
    // A top turn that records (or tried to) passes its decision on.
    owner = await port.startTurnUnit(sessionId, turnId, top !== undefined)
  } catch (error: unknown) {
    log.warn(`No turn record was made: ${failureForLog(error)}`)
    if (top !== undefined) {
      throw new Error(UI_TEXT.checkpointFailed, { cause: error })
    }
    return { kind: 'failed' }
  }
  if (top !== undefined && owner === undefined) {
    throw new Error(UI_TEXT.childCheckpointFailed)
  }
  return owner === undefined ? OFF : { kind: 'recording', owner, writes: recorder.start(owner) }
}

/**
 * A Model API turn ended (Stop and cancellation alike): its writes settle
 * first (no new one is admitted, those under way finish), then its unit is
 * folded and sealed when it recorded, and only then is its running mark
 * withdrawn. A unit that could not be sealed keeps the mark until it is.
 */
export async function finishCheckpointTurn(
  port: CheckpointPort,
  recorder: TurnRecorderApi | undefined,
  sessionId: string,
  turnId: string,
  end: TurnEnd,
): Promise<void> {
  const { checkpoint } = end
  if (checkpoint?.kind === 'recording') {
    await recorder?.end(checkpoint.owner)
    await port.endUnit(checkpoint.owner, { ranProcesses: end.ranProcesses })
  }
  await port.markTurn(turnKey(sessionId, turnId), false)
}

/**
 * An explicit local file edit owns admission until its actual I/O settles.
 * A lease that cannot be let go is logged, never the edit's failure: the
 * edit is done, and the mark left behind keeps restores closed (CC-M9c).
 */
export async function withCheckpointEdit<T>(
  checkpoints: CheckpointPort,
  log: Pick<Logger, 'warn'>,
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
    try {
      await checkpoints.markTurn(key, false)
    } catch (error: unknown) {
      log.warn(`An edit's checkpoint lease could not be let go: ${failureForLog(error)}`)
    }
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
  log: Pick<Logger, 'warn'>,
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
  return await withCheckpointEdit(checkpoints, log, check, work)
}

/**
 * The window's tool io (M86): every tool write refused in the checkpoint
 * storage, and every command and hook marked as workspace activity, so no
 * restore runs meanwhile. It records nothing: a turn's own io records its
 * writes (`writeRecorder`), and what else writes through this one (Muse
 * Code's image tools, the extension for the user) is never recorded.
 */
export function withCheckpointStorageGuard(io: ToolIo, checkpoints: CheckpointPort): ToolIo {
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
    runShell: async (
      command,
      cwd,
      timeoutMs,
      signal,
      limit,
      assertCanRun,
      isInteractive,
      resourceKind,
    ) =>
      await activity(
        async () =>
          await io.runShell(
            command,
            cwd,
            timeoutMs,
            signal,
            limit,
            assertCanRun,
            isInteractive,
            resourceKind,
          ),
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
    reserveFile: async (absolutePath, expectedCanonicalPath, beforeCreate) => {
      checkpoints.refuseStorageWrite(absolutePath)
      return await io.reserveFile(absolutePath, expectedCanonicalPath, beforeCreate)
    },
  }
}
