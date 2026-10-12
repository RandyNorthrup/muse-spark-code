// Generated-only crash fixture: real epoch publication (mutex guardian,
// exclusive writer, identity probe) in a child. The parent SIGKILLs the
// publisher at a stage point, then runs two starters through the production
// contender path.
import path from 'node:path'
import {
  UnixVaultPrivateFiles,
  type VaultPrivateFilesPort,
} from '../../../../src/core/vault/broker/files'
import { VaultLockEpoch } from '../../../../src/core/vault/broker/epoch'
import {
  holdVaultStartupLock,
  vaultProcessIdentity,
} from '../../../../src/runtime/vault/posixNative'
import { bumpVaultEpoch } from '../../../../src/runtime/vault/epochContender'
import { MILLISECONDS_PER_SECOND } from '../../../../src/shared/constants'

const runDirectory = path.resolve(process.argv[2] ?? '')
const helper = path.resolve(process.argv[3] ?? '')
const action = process.argv[4]
const stopAt = process.argv[5]
/**
 * Announce the parent's chosen stage, then park on an unsettled promise with
 * a heartbeat keeping the event loop alive until the parent's SIGKILL.
 */
async function point(stage: string): Promise<void> {
  if (stage !== stopAt) return
  const parked = new Promise<void>(() => {
    /* No resolution: parked until SIGKILL. */
  })
  process.stdout.write(`${JSON.stringify({ kind: 'stage', stage })}\n`)
  const beat = setInterval(() => {
    /* Heartbeat only: the parked promise never resolves. */
  }, MILLISECONDS_PER_SECOND)
  try {
    await parked
  } finally {
    clearInterval(beat)
  }
}
class InterruptedFiles extends UnixVaultPrivateFiles {
  override async claim(
    file: string,
    bytes: Uint8Array,
  ): Promise<Awaited<ReturnType<VaultPrivateFilesPort['claim']>>> {
    // Park between the temporary write and its publication link for the
    // writer-opened row: the production boundary, not a copy of it.
    const release = await super.claim(file, bytes, async () => {
      if (path.basename(file) === 'lock-epoch.writer') await point('writer-opened')
    })
    if (path.basename(file) === 'lock-epoch.writer') await point('writer-claimed')
    return async () => {
      await release()
      if (path.basename(file) === 'lock-epoch.writer') await point('writer-released')
    }
  }
  override async read(file: string, maxBytes?: number): Promise<Buffer> {
    // Before the attempt: a first-ever publication reads a file that is not
    // there yet, and the pause must still catch the step.
    if (path.basename(file) === 'lock-epoch.v1') await point('epoch-read')
    return await super.read(file, maxBytes)
  }
  override async replace(file: string, bytes: Uint8Array, authorize?: () => void): Promise<void> {
    await super.replace(file, bytes, authorize)
    if (path.basename(file) === 'lock-epoch.v1') await point('epoch-written')
  }
}
async function run(): Promise<void> {
  const identity = await vaultProcessIdentity(helper, process.pid)
  if (identity === null) throw new Error('fixture process disappeared')
  const self = { processId: identity.processId, startedAt: identity.startedAt }
  const files = new InterruptedFiles()
  if (action === 'start') {
    // The production contender path: kernel mutex plus decide-by-rule.
    const value = await bumpVaultEpoch(helper, runDirectory, files, self)
    process.stdout.write(`${JSON.stringify({ kind: 'complete', value })}\n`)
  } else if (action === 'publish') {
    // The lone publisher's stages, pausable at each step for SIGKILL.
    const held = await holdVaultStartupLock(
      helper,
      path.join(runDirectory, 'lock-epoch.lock'),
      true,
    )
    try {
      await point('mutex-acquired')
      const epoch = new VaultLockEpoch(runDirectory, files, self)
      const value = await epoch.bump()
      process.stdout.write(`${JSON.stringify({ kind: 'complete', value })}\n`)
    } finally {
      await held.release()
    }
  } else throw new Error('unknown fixture action')
}
void run()
  .then(() => {
    process.exitCode = 0
  })
  .catch((error: unknown) => {
    process.stdout.write(
      `${JSON.stringify({ kind: 'refused', reason: error instanceof Error ? error.message : 'io' })}\n`,
    )
    process.exitCode = 1
  })
