// What the conversations see of turn checkpoints (M72, PLAN.md D51): one
// store per window over the first workspace folder. New checkpoints are
// taken and offered only while the workspace is trusted, git is on PATH and
// `museSpark.turnCheckpoints` is on. Restricted Mode runs no git (D24), so
// it has none, and the panel says so; so does a window with no folder, no
// git or the setting off. What is already under way still finishes with the
// setting off (a turn's end, a Redo), and cleanup runs whatever the
// posture: an archived conversation's checkpoints go at once when git may
// run, and at the next trusted opening otherwise.

import type { FileReservation, ShellResult, ToolIo } from '../../core/backends/modelapi/tools'
import { refusedShellEntry, ShellEntryError } from '../../core/shellResult'
import { randomUUID } from 'node:crypto'
import { failureForLog } from '../../core/backends/musecode/logText'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { turnKey } from '../../core/checkpoints/turnKey'
import { isBelow } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import type {
  CaptureResult,
  CheckpointStore,
  RedoRequest,
  RestoreOutcome,
  RestoreRequest,
  Snapshot,
} from './checkpointStore'

export interface CheckpointPort {
  /** Native uncertainty persists independently of the capture setting. */
  isNativeUnsafe(): boolean
  markNativeBackend(): Promise<void>
  markUnprovenProcess(): Promise<void>
  availability(): CheckpointAvailability
  /** A capture of the workspace; undefined while checkpoints are not on. */
  capture(): Promise<CaptureResult | undefined>
  /** A capture no turn took. */
  release(snapshot: Snapshot): Promise<void>
  record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void>
  /**
   * A turn (or a message about to start one) begins or stops running in the
   * window, published at once with no lock or git: no restore runs meanwhile,
   * here or in another current window in the canonical-root storage namespace.
   */
  markTurn(key: string, isRunning: boolean): Promise<void>
  endTurn(sessionId: string, turnId: string): Promise<void>
  turns(sessionId: string): Promise<readonly string[]>
  legacyTurns(sessionId: string): Promise<readonly string[]>
  restore(request: RestoreRequest): Promise<RestoreOutcome>
  redo(request: RedoRequest): Promise<RestoreOutcome>
  forgetSession(sessionId: string): Promise<void>
  /** The window opened or was trusted: cleanup and retention, whatever the setting. */
  maintain(): Promise<void>
  /** Copies a file the extension's tools are about to write; a failed copy fails the write. */
  beforeToolWrite(absolutePath: string): Promise<void>
}

/** What the port uses of the store. */
export type CheckpointStoreApi = Pick<
  CheckpointStore,
  | 'capture'
  | 'release'
  | 'record'
  | 'markTurn'
  | 'endTurn'
  | 'turns'
  | 'restore'
  | 'redo'
  | 'forgetSession'
  | 'queueForget'
  | 'maintain'
  | 'beforeToolWrite'
  | 'isNativeUnsafe'
  | 'markNativeBackend'
  | 'markUnprovenProcess'
>

export interface CheckpointHostDeps {
  readonly isNamespaceKnown: () => boolean
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
  /** The store while new checkpoints are taken and offered. */
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
    capture: async () => await onStore()?.capture(),
    release: async (snapshot) => {
      await gitStore()?.release(snapshot)
    },
    record: async (sessionId, turnId, snapshot) => {
      const store = onStore()
      await (store === undefined
        ? gitStore()?.release(snapshot)
        : store.record(sessionId, turnId, snapshot))
    },
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
    endTurn: async (sessionId, turnId) => {
      await gitStore()?.endTurn(sessionId, turnId)
    },
    turns: async (sessionId) => (await onStore()?.turns(sessionId)) ?? [],
    legacyTurns: async (sessionId) =>
      availability() === 'on' ? ((await deps.legacyTurns?.(sessionId)) ?? []) : [],
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
    maintain: async () => {
      await gitStore()?.maintain()
    },
    beforeToolWrite: async (absolutePath) => {
      await onStore()?.beforeToolWrite(absolutePath)
    },
  }
}

/** Model API turns await their preimage/record before hooks or edits, including queued turns. */
export async function prepareCheckpointTurn(
  port: CheckpointPort,
  sessionId: string,
  turnId: string,
  log: Logger,
): Promise<void> {
  await port.markTurn(turnKey(sessionId, turnId), true)
  if (port.availability() !== 'on') {
    return
  }
  let captured: Snapshot | undefined
  try {
    const recorded = await port.turns(sessionId)
    if (recorded.includes(turnId)) {
      return
    }
    const result = await port.capture()
    if (result === undefined) {
      log.warn('No pre-turn checkpoint was captured: unavailable')
      return
    }
    if (!result.ok) {
      log.warn(`No pre-turn checkpoint was captured: ${result.reason}`)
      return
    }
    captured = result.snapshot
    await port.record(sessionId, turnId, captured)
  } catch (error: unknown) {
    log.warn(`No pre-turn checkpoint was recorded: ${failureForLog(error)}`)
    if (captured !== undefined) {
      try {
        await port.release(captured)
      } catch (releaseError: unknown) {
        log.warn(`A refused pre-turn capture could not be released: ${failureForLog(releaseError)}`)
      }
    }
  }
}

/** An explicit local file edit owns admission until its actual I/O settles. */
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
    await checkpoints.markTurn(key, false)
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
 * The tools' file access with a checkpoint copy before every write: the
 * Model API's `write_file` and `edit_file`, and a generated image's new file.
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
      await checkpoints.beforeToolWrite(absolutePath)
      await io.writeFile(absolutePath, content, expectedCanonicalPath, assertCanWrite)
    },
    writeFileIfUnchanged: async (...args: Parameters<ToolIo['writeFileIfUnchanged']>) => {
      await checkpoints.beforeToolWrite(args[0])
      return await conditionalWrite(...args)
    },
    reserveFile: async (absolutePath, expectedCanonicalPath): Promise<FileReservation> => {
      await checkpoints.beforeToolWrite(absolutePath)
      return await io.reserveFile(absolutePath, expectedCanonicalPath)
    },
  }
}
