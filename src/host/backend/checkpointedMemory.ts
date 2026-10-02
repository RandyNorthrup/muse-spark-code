// Muse Code's memory under turn checkpoints (M72, M86; PLAN.md D51, D63).
// This is the one composition activation builds, and the one its regression
// tests build:
// - the model's memory tools write through the window-wide checkpoint io,
//   which refuses the checkpoint storage; a turn's writes are recorded by its
//   own owner-bound io (writeRecorder.ts);
// - an exclusive creation, which has no ToolIo call, is refused the same way
//   before its no-clobber publication;
// - the Memory view's writes are the user's and never recorded; its creation
//   and trash hold the pure checkpoint lease until their native promises
//   settle, so another window's restore cannot overlap them. A scope outside
//   the workspace (Muse Code's personal data folders) takes no project lease
//   and keeps only the lifetime guard.

import type { ToolIo } from '../../core/backends/modelapi/tools'
import { MemoryStore, type MemoryStoreDeps } from '../../core/memory/memoryStore'
import {
  type CheckpointPort,
  withCheckpointCopies,
  withCheckpointEditAt,
} from '../checkpoints/checkpointHost'
import type { MemoryEdit } from '../commands/memoryCommands'
import { createMemoryIo } from './memoryIo'

export interface CheckpointedMemoryDeps extends Omit<MemoryStoreDeps, 'io'> {
  /**
   * A guard for one mutation, captured when it starts: it throws once the
   * window or the backend it was taken for is gone.
   */
  readonly captureGuard: () => () => void
}

export interface CheckpointedMemory {
  /** The model's memory tools' store. */
  readonly store: MemoryStore
  /** The Memory view's store, over the same io. */
  readonly viewStore: MemoryStore
  /** The Memory view's mutations: the pure lease for notes under the workspace, held until the work settles. */
  readonly edit: MemoryEdit
}

export function createCheckpointedMemory(
  files: ToolIo,
  checkpoints: CheckpointPort,
  deps: CheckpointedMemoryDeps,
): CheckpointedMemory {
  const { captureGuard, ...storeDeps } = deps
  const io = createMemoryIo(withCheckpointCopies(files, checkpoints), {
    warn: storeDeps.warn,
    beforeCreate: (absolutePath) => {
      checkpoints.refuseStorageWrite(absolutePath)
      return Promise.resolve()
    },
  })
  const store = new MemoryStore({ ...storeDeps, io })
  return {
    store,
    viewStore: new MemoryStore({ ...storeDeps, io }),
    edit: async (scope, work) => {
      const check = captureGuard()
      check()
      const root = await store.root(scope)
      return await withCheckpointEditAt(
        checkpoints,
        check,
        { root: storeDeps.workspaceRoot, platform: storeDeps.platform },
        root.ok ? root.value : undefined,
        async () => await work(check),
      )
    },
  }
}
