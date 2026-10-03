// The review's Revert adapters exactly as activation wires them (M70).
// src/extension.ts is outside the unit run (vitest.config.ts), so the
// object-literal source between `withAdmission` and `openDiff` in its
// `lazyReview({...})` is evaluated over the bindings a test gives for its free
// names: the real lease and Revert publication, the tools' real file access
// by default, and the test's own window guard, checkpoint port and trash.

import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { vi } from 'vitest'
import type { ToolIo } from '../../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../../src/host/backend/toolIo'
import {
  type CheckpointPort,
  createCheckpointPort,
  withCheckpointEdit,
} from '../../../src/host/checkpoints/checkpointHost'
import type { EditReviewDeps } from '../../../src/host/editor/editReview'
import { createRevertIo } from '../../../src/host/editor/revertIo'

export type ActivationRevert = Pick<EditReviewDeps, 'withAdmission' | 'io'>

/** An edit that only took `removed` out before `tail` in `notes.md`: reverted twice, it doubles. */
export const DELETION_ONLY_PATCH = JSON.stringify({
  files: [
    {
      path: 'notes.md',
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: ['-removed', ' tail'] }],
    },
  ],
})

/** The window's guard while it stays admitted. */
export const admitted = () => undefined

/** Admission granted, then not let go (its presence file is not written). */
export const failsRelease = (isRunning: boolean) =>
  isRunning ? Promise.resolve() : Promise.reject(new Error('presence not written'))

/** A checkpoint port with no store whose admission (`markTurn`) the test drives. */
export function admissionPort(mark: (isRunning: boolean) => Promise<void>) {
  const checkpoints = createCheckpointPort({
    isNamespaceKnown: () => true,
    store: undefined,
    isWorkspaceTrusted: () => true,
    isEnabled: () => false,
    hasGit: () => false,
  })
  const marks: boolean[] = []
  vi.spyOn(checkpoints, 'markTurn').mockImplementation(async (_key, isRunning) => {
    marks.push(isRunning)
    await mark(isRunning)
  })
  return { checkpoints, marks }
}

/** Function signatures belong to this tree's activation adapters, not external input. */
function isActivationRevert(value: unknown): value is ActivationRevert {
  return (
    typeof value === 'object' &&
    value !== null &&
    'withAdmission' in value &&
    typeof value.withAdmission === 'function' &&
    'io' in value &&
    typeof value.io === 'object' &&
    value.io !== null
  )
}

/** Activation's Revert adapters, evaluated over `bindings` (the free names they use). */
export function activationRevert(bindings: Readonly<Record<string, unknown>>): ActivationRevert {
  const source = readFileSync(new URL('../../../src/extension.ts', import.meta.url), 'utf8')
  const review = source.indexOf('const review = lazyReview(')
  const start = source.indexOf('withAdmission: async', review)
  const end = source.indexOf('openDiff: async', start)
  if (review === -1 || start < review || end <= start) {
    throw new Error('activation review adapters were not found')
  }
  const value: unknown = runInNewContext(`({${source.slice(start, end)}})`, bindings)
  if (!isActivationRevert(value)) {
    throw new Error('activation review adapters are not callable')
  }
  return value
}

/** The tools' real file access over this machine's files, editors dirty at `unsavedFiles`. */
export function nativeToolIo(unsavedFiles: () => readonly string[] = () => []): ToolIo {
  return createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => ({}),
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles,
  })
}

export interface RevertWiring {
  readonly checkpoints: CheckpointPort
  /** The backend manager's `workspaceActionGuard`, as activation calls it. */
  readonly guard: (signal: AbortSignal) => () => void
  /** The window's native-start signal. */
  readonly signal?: AbortSignal
  /** The tools' file access; the real one by default. */
  readonly toolIo?: Pick<ToolIo, 'writeFileIfUnchanged' | 'hasUnsavedChanges'>
  /** `vscode.workspace.fs.delete`; removes the file by default. */
  readonly trash?: (fsPath: string, options: { readonly useTrash: boolean }) => Promise<void>
}

/** Activation's Revert adapters over the real lease and publication. */
export function wiredRevert(wiring: RevertWiring): ActivationRevert {
  const trash = wiring.trash ?? ((fsPath: string) => rm(fsPath))
  return activationRevert({
    backend: { workspaceActionGuard: wiring.guard },
    nativeStarts: { signal: wiring.signal ?? new AbortController().signal },
    checkpoints: wiring.checkpoints,
    withCheckpointEdit,
    createRevertIo,
    toolIo: wiring.toolIo ?? nativeToolIo(),
    process: { platform: process.platform },
    vscode: {
      Uri: { file: (fsPath: string) => fsPath },
      workspace: { fs: { delete: trash } },
    },
  })
}
