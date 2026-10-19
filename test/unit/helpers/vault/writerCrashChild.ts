// Generated-only crash fixture: real NodeVaultFiles/VaultStore transactions in a child.
import path from 'node:path'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import * as z from 'zod/mini'
import { NodeVaultFiles, VaultStore, type VaultFilePort } from '../../../../src/core/vault/store'
import { createRecoverySlot } from '../../../../src/core/vault/keyslots'
import { createEncryptedBackup, restoreEncryptedBackup } from '../../../../src/core/vault/backup'
import { VaultError } from '../../../../src/core/vault/crypto'
import { VAULT_LIMITS, MILLISECONDS_PER_SECOND } from '../../../../src/shared/constants'
import { type VaultAnchorPort } from '../../../../src/core/vault/broker/repository'

const stateSchema = z.strictObject({
  generation: z.number(),
  auditGeneration: z.number(),
  auditHead: z.string(),
  stateDigest: z.string(),
})
const root = path.resolve(process.argv[2] ?? '')
const action = process.argv[3]
const stopAt = process.argv[4]
const vaultId = 'a'.repeat(32)
const anchorPath = path.join(root, 'protected-anchor.json')
async function point(stage: string): Promise<void> {
  if (stage !== stopAt) return
  await new Promise<void>(() => {
    process.stdout.write(`${JSON.stringify({ kind: 'stage', stage })}\n`)
    setInterval(() => {
      /* Keep the child alive until SIGKILL at this exact stage. */
    }, MILLISECONDS_PER_SECOND)
  })
}
const anchor: VaultAnchorPort = {
  vaultId: async () => ((await anchor.minimum(vaultId)) === null ? null : vaultId),
  minimum: async () => {
    try {
      const bytes = await readFile(anchorPath)
      return stateSchema.parse(JSON.parse(bytes.toString()))
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  },
  advance: async (id, state, prior) => {
    if (id !== vaultId || JSON.stringify(await anchor.minimum(id)) !== JSON.stringify(prior))
      throw new VaultError('rollback')
    await writeFile(`${anchorPath}.tmp`, JSON.stringify(state), { mode: 0o600 })
    await rename(`${anchorPath}.tmp`, anchorPath)
    await point('anchor-advanced')
  },
  reset: async (id, expected, authorize) => {
    authorize()
    if (id !== vaultId || JSON.stringify(await anchor.minimum(id)) !== JSON.stringify(expected))
      throw new VaultError('rollback')
    await unlink(anchorPath)
    await point('anchor-retired')
  },
}
class InterruptedFiles extends NodeVaultFiles {
  override async withWriter<T>(operation: (assertHeld: () => void) => Promise<T>): Promise<T> {
    return await super.withWriter(async (assertHeld) => {
      await point('writer-acquired')
      return await operation(assertHeld)
    })
  }
  override async writeAtomic(...args: Parameters<VaultFilePort['writeAtomic']>): Promise<void> {
    await super.writeAtomic(...args)
    await point(`${args[0]}-written`)
  }
  override async quarantine(...args: Parameters<VaultFilePort['quarantine']>): Promise<void> {
    await super.quarantine(...args)
    await point('quarantine-retained')
  }
  override async remove(...args: Parameters<VaultFilePort['remove']>): Promise<void> {
    await super.remove(...args)
    await point(`${args[0]}-removed`)
  }
}
async function run(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const bytes of process.stdin) {
    if (!(bytes instanceof Buffer)) throw new TypeError('private fixture input')
    chunks.push(bytes)
  }
  const encoded = Buffer.concat(chunks)
  const key = Buffer.from(encoded.toString(), 'base64')
  encoded.fill(0)
  for (const bytes of chunks) bytes.fill(0)
  try {
    const files = new InterruptedFiles(path.join(root, 'vault'), VAULT_LIMITS.frameBytes)
    const options = { files, anchor, key }
    const clear = () => {
      /* This fixture has no cancellation during a completed stage. */
    }
    const create = async () => {
      const recovery = createRecoverySlot(key, vaultId, { now: Date.now })
      try {
        return await VaultStore.create(options, vaultId, [recovery.slot])
      } finally {
        recovery.code.fill(0)
      }
    }
    switch (action) {
      case 'prepare-reset':
      case 'prepare-restore': {
        const store = await create()
        try {
          if (action === 'prepare-restore') {
            const snapshot = await store.exportSnapshot()
            const slot = snapshot.slots.records[0]
            if (!slot) throw new Error('missing recovery slot')
            const backup = await createEncryptedBackup(store, key, slot)
            await writeFile(path.join(root, 'backup'), backup, { mode: 0o600 })
            backup.fill(0)
            await files.writeAtomic('vault.v1', Buffer.from('damaged generated document'))
          } else {
            await files.writeAtomic('slots.v1', Buffer.from('damaged generated slots'))
            await files.writeAtomic('pending.v1', Buffer.from('damaged generated intent'))
          }
        } finally {
          store.lock()
        }
        break
      }
      case 'reset':
      case 'recover-reset': {
        const expected = await anchor.minimum(vaultId)
        if (expected !== null)
          await VaultStore.resetLost(
            files,
            vaultId,
            JSON.stringify({ kind: 'vaultReset' }),
            clear,
            () => anchor.reset(vaultId, expected, clear),
            anchor,
            expected,
          )
        if (action === 'recover-reset') {
          const store = await create()
          try {
            const items = await store.list()
            if (items.length > 0) throw new Error('unexpected recovered items')
          } finally {
            store.lock()
          }
        }
        break
      }
      case 'restore':
      case 'recover-restore': {
        let store: VaultStore | undefined
        if (action === 'recover-restore') {
          try {
            store = await VaultStore.open(options, vaultId)
          } catch (error: unknown) {
            if (!(error instanceof VaultError) || error.code === 'busy') throw error
          }
        }
        store ??= await restoreEncryptedBackup(
          options,
          await readFile(path.join(root, 'backup')),
          VAULT_LIMITS.frameBytes,
          true,
        )
        try {
          const items = await store.list()
          if (items.length > 0) throw new Error('unexpected restored items')
          await store.exportSnapshot()
        } finally {
          store.lock()
        }
        break
      }
      case 'open': {
        const store = await VaultStore.open(options, vaultId)
        store.lock()
        break
      }
      default: {
        throw new Error('unknown fixture action')
      }
    }
    process.stdout.write(`${JSON.stringify({ kind: 'complete' })}\n`)
  } finally {
    key.fill(0)
  }
}
void run().catch((error: unknown) => {
  process.stdout.write(
    `${JSON.stringify({ kind: 'refused', reason: error instanceof VaultError ? error.code : 'io' })}\n`,
  )
  process.exitCode = 1
})
