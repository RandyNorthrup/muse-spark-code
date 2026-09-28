// What the conversations see of turn checkpoints (M72, PLAN.md D51): one
// store per window over the first workspace folder. New checkpoints are
// taken and offered only while the workspace is trusted, git is on PATH and
// `museSpark.turnCheckpoints` is on. Restricted Mode runs no git (D24), so
// it has none, and the panel says so; so does a window with no folder, no
// git or the setting off. What is already under way still finishes with the
// setting off (a turn's end, a Redo), and cleanup runs whatever the
// posture: an archived conversation's checkpoints go at once when git may
// run, and at the next trusted opening otherwise.

import type { FileReservation, ToolIo } from '../../core/backends/modelapi/tools'
import type { CheckpointAvailability } from '../../shared/constants'
import { errorDetail, type Logger } from '../logger'
import type {
  CaptureResult,
  CheckpointStore,
  RedoRequest,
  RestoreOutcome,
  RestoreRequest,
  Snapshot,
} from './checkpointStore'

export interface CheckpointPort {
  availability(): CheckpointAvailability
  /** A capture of the workspace; undefined while checkpoints are not on. */
  capture(): Promise<CaptureResult | undefined>
  /** A capture no turn took. */
  release(snapshot: Snapshot): Promise<void>
  record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void>
  /** A turn started or ended in the window (no git): no restore runs meanwhile. */
  markTurn(sessionId: string, turnId: string, isRunning: boolean): void
  endTurn(sessionId: string, turnId: string): Promise<void>
  turns(sessionId: string): Promise<readonly string[]>
  restore(request: RestoreRequest): Promise<RestoreOutcome>
  redo(request: RedoRequest): Promise<RestoreOutcome>
  forgetSession(sessionId: string): Promise<void>
  /** The window opened or was trusted: cleanup and retention, whatever the setting. */
  maintain(): Promise<void>
  /** Copies a file the extension's tools are about to write; never fails the write. */
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
>

export interface CheckpointHostDeps {
  /** Undefined without a folder or workspace storage. */
  readonly store: CheckpointStoreApi | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly isEnabled: () => boolean
  /** Whether git is on the absolute entries of PATH (D24). */
  readonly hasGit: () => boolean
  readonly log: Logger
}

const UNAVAILABLE: RestoreOutcome = { ok: false, reason: 'unavailable' }

export function createCheckpointPort(deps: CheckpointHostDeps): CheckpointPort {
  const availability = (): CheckpointAvailability => {
    if (deps.store === undefined) {
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
    markTurn: (sessionId, turnId, isRunning) => {
      deps.store?.markTurn(sessionId, turnId, isRunning)
    },
    endTurn: async (sessionId, turnId) => {
      await gitStore()?.endTurn(sessionId, turnId)
    },
    turns: async (sessionId) => (await onStore()?.turns(sessionId)) ?? [],
    restore: async (request) => (await onStore()?.restore(request)) ?? UNAVAILABLE,
    redo: async (request) => (await gitStore()?.redo(request)) ?? UNAVAILABLE,
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
      try {
        await onStore()?.beforeToolWrite(absolutePath)
      } catch (error: unknown) {
        deps.log.warn(`Checkpoint copy before a tool write failed: ${errorDetail(error)}`)
      }
    },
  }
}

/**
 * The tools' file access with a checkpoint copy before every write: the
 * Model API's `write_file` and `edit_file`, and a generated image's new file.
 */
export function withCheckpointCopies(io: ToolIo, checkpoints: CheckpointPort): ToolIo {
  return {
    ...io,
    writeFile: async (absolutePath, content, expectedCanonicalPath) => {
      await checkpoints.beforeToolWrite(absolutePath)
      await io.writeFile(absolutePath, content, expectedCanonicalPath)
    },
    reserveFile: async (absolutePath, expectedCanonicalPath): Promise<FileReservation> => {
      await checkpoints.beforeToolWrite(absolutePath)
      return await io.reserveFile(absolutePath, expectedCanonicalPath)
    },
  }
}
