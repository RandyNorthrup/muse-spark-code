// A manual bundle split: loading is synchronous at the existing store
// construction point. Startup maintenance and admission are not deferred.
import type { UiText } from '../../shared/l10n/en'
import { UI_TEXT } from '../../shared/constants'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import type { CheckpointStore, CheckpointStoreDeps } from './checkpointStore'
import type { LegacyCheckpointDeps } from './legacyCheckpoints'
import type { createTurnRecording } from './writeRecorder'

interface CheckpointStoreBundle {
  readonly createCheckpointStore: (
    deps: CheckpointStoreDeps,
    table: UiText,
    locale: string,
  ) => CheckpointStore
  readonly legacyCheckpointTurns: (
    deps: LegacyCheckpointDeps,
    sessionId: string,
    table: UiText,
    locale: string,
  ) => Promise<readonly string[]>
  readonly createTurnRecording: typeof createTurnRecording
}

/** Function signatures are trusted only for our same-build packaged module (PLAN.md §8). */
export function isCheckpointStoreBundle(value: unknown): value is CheckpointStoreBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createCheckpointStore' in value &&
    typeof value.createCheckpointStore === 'function' &&
    'legacyCheckpointTurns' in value &&
    typeof value.legacyCheckpointTurns === 'function' &&
    'createTurnRecording' in value &&
    typeof value.createTurnRecording === 'function'
  )
}

export interface CheckpointStoreLoaderDeps {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** Missing/malformed modules refuse construction; a later call can retry a repaired file. */
export function checkpointStoreLoader(
  deps: CheckpointStoreLoaderDeps,
): () => CheckpointStoreBundle {
  let bundle: CheckpointStoreBundle | undefined
  return () => {
    if (bundle !== undefined) {
      return bundle
    }
    const { bundlePath, loadBundle = requireFile } = deps
    let loaded: unknown
    try {
      loaded = loadBundle(bundlePath)
    } catch (error: unknown) {
      deps.log.error(`The checkpoint store ${bundlePath} could not be loaded`)
      throw new Error(UI_TEXT.checkpointFailed, { cause: error })
    }
    if (!isCheckpointStoreBundle(loaded)) {
      deps.log.error(`${bundlePath} does not export the checkpoint store factory and legacy reader`)
      if (deps.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      throw new Error(UI_TEXT.checkpointFailed)
    }
    bundle = loaded
    return bundle
  }
}
