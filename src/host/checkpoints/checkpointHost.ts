// What the conversations see of turn checkpoints (M72, PLAN.md D51): one
// store per window over the first workspace folder, used only while the
// workspace is trusted and `museSpark.turnCheckpoints` is on. Restricted
// Mode runs no git (D24), so it has no checkpoints, and the panel says so;
// so does a window with no folder or the setting off.

import type { FileReservation, ToolIo } from '../../core/backends/modelapi/tools'
import type { CheckpointAvailability } from '../../shared/constants'
import { errorDetail, type Logger } from '../logger'
import {
  type CaptureResult,
  type CheckpointStore,
  type RedoRequest,
  type RestoreOutcome,
  type RestoreRequest,
  type Snapshot,
} from './checkpointStore'

export interface CheckpointPort {
  availability(): CheckpointAvailability
  /** A capture of the workspace; undefined while checkpoints are unavailable. */
  capture(): Promise<CaptureResult | undefined>
  record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void>
  endTurn(sessionId: string, turnId: string): Promise<void>
  turns(sessionId: string): Promise<readonly string[]>
  restore(request: RestoreRequest): Promise<RestoreOutcome>
  redo(request: RedoRequest): Promise<RestoreOutcome>
  forgetSession(sessionId: string): Promise<void>
  /** Copies a file the extension's tools are about to write; never fails the write. */
  beforeToolWrite(absolutePath: string): Promise<void>
}

/** What the port uses of the store. */
export type CheckpointStoreApi = Pick<
  CheckpointStore,
  | 'capture'
  | 'record'
  | 'endTurn'
  | 'turns'
  | 'restore'
  | 'redo'
  | 'forgetSession'
  | 'beforeToolWrite'
>

export interface CheckpointHostDeps {
  /** Undefined without a folder or workspace storage. */
  readonly store: CheckpointStoreApi | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly isEnabled: () => boolean
  readonly log: Logger
}

const UNAVAILABLE: RestoreOutcome = { ok: false, reason: 'noCheckpoint' }

export function createCheckpointPort(deps: CheckpointHostDeps): CheckpointPort {
  const availability = (): CheckpointAvailability => {
    if (deps.store === undefined) {
      return 'noFolder'
    }
    if (!deps.isWorkspaceTrusted()) {
      return 'restricted'
    }
    return deps.isEnabled() ? 'on' : 'off'
  }
  const store = (): CheckpointStoreApi | undefined =>
    availability() === 'on' ? deps.store : undefined
  return {
    availability,
    capture: async () => await store()?.capture(),
    record: async (sessionId, turnId, snapshot) => {
      await store()?.record(sessionId, turnId, snapshot)
    },
    endTurn: async (sessionId, turnId) => {
      await store()?.endTurn(sessionId, turnId)
    },
    turns: async (sessionId) => (await store()?.turns(sessionId)) ?? [],
    restore: async (request) => (await store()?.restore(request)) ?? UNAVAILABLE,
    redo: async (request) => (await store()?.redo(request)) ?? UNAVAILABLE,
    // Cleanup runs whatever the posture: an archived conversation's copies go.
    forgetSession: async (sessionId) => {
      if (deps.store !== undefined && deps.isWorkspaceTrusted()) {
        await deps.store.forgetSession(sessionId)
      }
    },
    beforeToolWrite: async (absolutePath) => {
      try {
        await store()?.beforeToolWrite(absolutePath)
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
