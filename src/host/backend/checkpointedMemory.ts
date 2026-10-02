// Muse Code's memory under turn checkpoints (M72, M86, PLAN.md D63). This is
// the one composition activation builds, and the one its regression tests
// build:
// - the model's memory tools use one store for the window, and each call
//   writes through its turn's own recording writes (`turnWrites`): a
//   replacement through the turn's io, a new note's no-clobber publication
//   through the io's intent seam, both recorded for a restore. Without them
//   (nothing recorded) the store writes through the window's tool io, which
//   still refuses the checkpoint storage;
// - the Memory view has its own store over the raw io, which records
//   nothing: what the user does there is theirs, and a restore that finds a
//   note changed since the model's write leaves it alone;
// - the view's creation and trash hold the pure checkpoint lease until their
//   native promises settle, so another window's restore cannot overlap them.
//   A scope outside the workspace (Muse Code's personal data folders) takes
//   no project lease and keeps only the lifetime guard.

import type { ToolIo } from '../../core/backends/modelapi/tools'
import { MemoryStore, type MemoryStoreDeps, type MemoryWrites } from '../../core/memory/memoryStore'
import {
  type CheckpointPort,
  withCheckpointCopies,
  withCheckpointEditAt,
} from '../checkpoints/checkpointHost'
import type { OwnerIo } from '../checkpoints/writeRecorder'
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
  /** The model's memory tools' store: each call hands in its turn's writes. */
  readonly store: MemoryStore
  /** The Memory view's store, over the raw io: nothing it writes is recorded. */
  readonly viewStore: MemoryStore
  /** The Memory view's mutations: the pure lease for notes under the workspace, held until the work settles. */
  readonly edit: MemoryEdit
  /** A turn's memory writes through its own recording io (M86). */
  readonly turnWrites: (io: OwnerIo) => MemoryWrites
}

export function createCheckpointedMemory(
  files: ToolIo,
  checkpoints: CheckpointPort,
  deps: CheckpointedMemoryDeps,
): CheckpointedMemory {
  const { captureGuard, ...storeDeps } = deps
  const store = new MemoryStore({
    ...storeDeps,
    io: createMemoryIo(withCheckpointCopies(files, checkpoints), { warn: storeDeps.warn }),
  })
  return {
    store,
    viewStore: new MemoryStore({
      ...storeDeps,
      io: createMemoryIo(files, { warn: storeDeps.warn }),
    }),
    edit: async (scope, work) => {
      const check = captureGuard()
      check()
      const root = await store.root(scope)
      return await withCheckpointEditAt(
        checkpoints,
        { warn: storeDeps.warn },
        check,
        { root: storeDeps.workspaceRoot, platform: storeDeps.platform },
        root.ok ? root.value : undefined,
        async () => await work(check),
      )
    },
    turnWrites: (io) =>
      createMemoryIo(io, {
        warn: storeDeps.warn,
        recordNew: async (...args) => {
          await io.recordNew(...args)
        },
      }),
  }
}
