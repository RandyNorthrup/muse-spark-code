// Muse Code's memory under turn checkpoints (M72, PLAN.md D51). This is the
// one composition activation builds, and the one its regression tests build:
// - every replacement (a note, an edit, MEMORY.md) goes through the tools'
//   own checkpoint copy before it writes, with the caller's final guard;
// - an exclusive creation, which has no ToolIo call, takes the same copy
//   before its no-clobber publication;
// - the Memory view's creation and trash hold the pure checkpoint lease
//   until their native promises settle, so another window's restore cannot
//   overlap them. A scope outside the workspace (Muse Code's personal data
//   folders) takes no project lease and keeps only the lifetime guard;
// - a note is copied before the view moves it to the trash;
// - what the view writes or trashes is the user's, as their own save is: a
//   turn running meanwhile does not own it. The model's tools write through
//   `store`, whose writes stay the turn's to restore.

import type { ToolIo } from '../../core/backends/modelapi/tools'
import { type MemoryIo, MemoryStore, type MemoryStoreDeps } from '../../core/memory/memoryStore'
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
  /** The Memory view's store: each file it writes is noted as the user's once written. */
  readonly viewStore: MemoryStore
  /** The Memory view's mutations: the pure lease for notes under the workspace, held until the work settles. */
  readonly edit: MemoryEdit
  /** Keeps a note's bytes for a restore before the view deletes it. */
  readonly beforeDelete: (absolutePath: string) => Promise<void>
  /** The view trashed the note at the user's word: the removal is theirs. */
  readonly afterDelete: (absolutePath: string) => void
}

/** `io` whose completed writes are noted as the user's. */
function userWrites(io: MemoryIo, checkpoints: CheckpointPort): MemoryIo {
  return {
    ...io,
    writeFile: async (absolutePath, content, assertCanWrite) => {
      await io.writeFile(absolutePath, content, assertCanWrite)
      checkpoints.noteUserSave(absolutePath)
    },
    createFile: async (absolutePath, content, checkedPath, assertCanWrite) => {
      await io.createFile(absolutePath, content, checkedPath, assertCanWrite)
      checkpoints.noteUserSave(absolutePath)
    },
  }
}

export function createCheckpointedMemory(
  files: ToolIo,
  checkpoints: CheckpointPort,
  deps: CheckpointedMemoryDeps,
): CheckpointedMemory {
  const { captureGuard, ...storeDeps } = deps
  const io = createMemoryIo(withCheckpointCopies(files, checkpoints), {
    warn: storeDeps.warn,
    beforeCreate: (absolutePath) => checkpoints.beforeToolWrite(absolutePath),
  })
  const store = new MemoryStore({ ...storeDeps, io })
  return {
    store,
    viewStore: new MemoryStore({ ...storeDeps, io: userWrites(io, checkpoints) }),
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
    beforeDelete: (absolutePath) => checkpoints.beforeToolWrite(absolutePath),
    afterDelete: (absolutePath) => {
      checkpoints.noteUserSave(absolutePath)
    },
  }
}
