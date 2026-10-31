// The native conformance checkpoint leg (RLF-M104GL): drives the production
// runtime checkpoint adapter (createRuntimeCheckpoints) through the
// contract's checkpoint scenario (a checkpoint, an edit, a restore) and
// reports the observed text and turn count. Native harnesses spawn this
// through runDriver.mjs, which bundles it with esbuild; the unit suite
// imports it directly.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BackendKind } from '../../../src/core/agent/agentBackend'
import { canonicalPath } from '../../../src/host/canonicalPath'
import * as checkpointStoreEntry from '../../../src/host/checkpoints/checkpointStoreEntry'
import { createOwnerIo } from '../../../src/host/checkpoints/writeRecorder'
import type { Logger } from '../../../src/host/logger'
import { createRuntimeCheckpoints } from '../../../src/runtime/features/checkpoints'
import { SETTING_DEFAULTS } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import { resolveWorkingGit } from '../helpers/fixtureGit'
import { headlessToolIo } from '../helpers/headlessToolIo'

export interface CheckpointDriverArgs {
  readonly workspaceRoot: string
  readonly dataRoot: string
  readonly sessionId: string
  readonly backend: BackendKind
}

export interface CheckpointDriverResult {
  readonly text: string
  readonly checkpoints: number
}

export async function runCheckpointDriver(
  args: CheckpointDriverArgs,
  log: Logger,
): Promise<CheckpointDriverResult> {
  mkdirSync(args.workspaceRoot, { recursive: true })
  mkdirSync(args.dataRoot, { recursive: true })
  // The store's separation guard reads the enclosing repository top: the
  // scenario owns its repository, so the storage beside it is separate.
  // `git init` is idempotent, so a prepared workspace is untouched.
  const git = await resolveWorkingGit()
  execFileSync(git, ['init', '--quiet'], { cwd: args.workspaceRoot })
  const file = path.join(args.workspaceRoot, 'note.txt')
  writeFileSync(file, 'original')
  const root = await canonicalPath(args.workspaceRoot)
  const checkpoints = await createRuntimeCheckpoints(
    {
      workspaceRoot: args.workspaceRoot,
      dataRoot: args.dataRoot,
      // The loader below bypasses the dist bundle, so no dist directory applies.
      distDir: args.dataRoot,
      platform: process.platform,
      env: process.env,
      log,
      isTrusted: () => true,
      isEnabled: () => true,
      retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
      loadBundle: () => checkpointStoreEntry,
    },
    EN,
    'en',
  )
  try {
    const turnId = randomUUID()
    const owner = await checkpoints.port.startTurnUnit(args.sessionId, turnId, false)
    if (owner === undefined) throw new Error('the checkpoint turn recorded nothing')
    const ownerIo = createOwnerIo(headlessToolIo(args.workspaceRoot), {
      journal: checkpoints.recording.journal,
      lanes: checkpoints.recording.lanes,
      owner,
      workspaceRoot: root,
      platform: process.platform,
      canonicalPath,
      newId: () => randomUUID(),
      log,
    })
    try {
      await ownerIo.writeFile(file, 'changed', await canonicalPath(file), () => undefined)
    } finally {
      await ownerIo.drain()
    }
    if (readFileSync(file, 'utf8') !== 'changed')
      throw new Error('the checkpoint edit did not land')
    await checkpoints.port.endUnit(owner, { ranProcesses: false })
    const outcome = await checkpoints.port.restore({
      backend: () => args.backend,
      sessionId: args.sessionId,
      turnId,
      transcriptTurnIds: [turnId],
      // Headless: the agent cannot see editor buffers, so none are unsaved.
      unsavedPaths: () => [],
    })
    if (!outcome.ok) throw new Error('the checkpoint restore reported incomplete')
    const text = readFileSync(file, 'utf8')
    const turns = await checkpoints.port.turns(args.sessionId)
    return { text, checkpoints: turns.length }
  } finally {
    await checkpoints.dispose()
  }
}
