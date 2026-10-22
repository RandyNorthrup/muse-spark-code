import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { withoutCredentials } from '../../core/credentialEnvironment'
import type { UiText } from '../../shared/l10n/en'
import { CHECKPOINT_STORE_BUNDLE_FILE, CHECKPOINTS_DIR } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import { checkpointLocation } from '../../host/checkpoints/checkpointLocation'
import { checkpointStoreLoader } from '../../host/checkpoints/checkpointStoreBundle'
import { createCheckpointPort, type CheckpointPort } from '../../host/checkpoints/checkpointHost'
import { isProcessAlive } from '../../host/checkpoints/windowPresence'
import type { WindowRecording } from '../../host/checkpoints/writeRecorder'
import { processGitLocator, processGitProcess, type GitProcess } from '../../host/git'
import type { Logger } from '../../host/logger'
import { withoutKeyringRoutes } from '../credentialVariables'

export interface RuntimeCheckpointDeps {
  readonly workspaceRoot: string
  readonly dataRoot: string
  readonly distDir: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly isTrusted: () => boolean
  readonly isEnabled: () => boolean
  readonly retentionDays: () => number
  readonly log: Logger
  readonly onAvailabilityChanged?: () => void
  readonly git?: GitProcess
  readonly hasGit?: () => boolean
  readonly loadBundle?: (file: string) => unknown
}

export interface RuntimeCheckpoints {
  readonly port: CheckpointPort
  readonly recording: WindowRecording
  /** Cancels and drains store work before closing its write journal. */
  dispose(): Promise<void>
}

/** A runtime-owned physical-workspace namespace over the existing lazy store. */
export async function createRuntimeCheckpoints(
  deps: RuntimeCheckpointDeps,
  table: UiText,
  locale: string,
): Promise<RuntimeCheckpoints> {
  setUiText(table, locale)
  const location = await checkpointLocation(deps.workspaceRoot, deps.dataRoot, deps.platform)
  if (location === undefined) throw new Error('MHP_CHECKPOINT_NAMESPACE_UNAVAILABLE')
  const bundle = checkpointStoreLoader({
    bundlePath: path.join(deps.distDir, CHECKPOINT_STORE_BUNDLE_FILE),
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
  })()
  const recording = bundle.createTurnRecording({
    storageDir: location.storageDir,
    instance: randomUUID(),
    platform: deps.platform,
  })
  const store = bundle.createCheckpointStore(
    {
      workspaceRoot: location.canonicalRoot,
      displayRoot: deps.workspaceRoot,
      storageDir: location.storageDir,
      storageRoot: path.join(deps.dataRoot, CHECKPOINTS_DIR),
      instance: recording.instance,
      journal: recording.journal,
      lanes: recording.lanes,
      platform: deps.platform,
      env: withoutKeyringRoutes(withoutCredentials(deps.env)),
      git: deps.git ?? processGitProcess(),
      retentionDays: deps.retentionDays,
      now: Date.now,
      newId: randomUUID,
      pid: process.pid,
      isProcessAlive,
      log: deps.log,
    },
    table,
    locale,
  )
  const port = createCheckpointPort({
    store,
    isNamespaceKnown: () => true,
    isWorkspaceTrusted: deps.isTrusted,
    isEnabled: deps.isEnabled,
    hasGit: deps.hasGit ?? processGitLocator(),
    ...(deps.onAvailabilityChanged !== undefined && {
      onAvailabilityChanged: deps.onAvailabilityChanged,
    }),
  })
  let closing: Promise<void> | undefined
  const result: RuntimeCheckpoints = {
    port,
    recording,
    dispose: () => {
      closing ??= (async () => {
        try {
          await store.close()
        } finally {
          await recording.journal.close()
        }
      })()
      return closing
    },
  }
  try {
    await port.maintain()
    return result
  } catch (error: unknown) {
    await result.dispose()
    throw error
  }
}
