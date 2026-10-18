// The one credential lease (M95 D74): one owner per providers file across
// processes. A live lock is never stolen (a contender whose first read saw
// nothing still refuses once the owner's record lands), a crashed owner's
// lock never wedges the next command, and a contender that already lost a
// takeover race never deletes the winner's live lock. All on real files,
// with real process-liveness checks.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireCredentialLock,
  CredentialLockBusyError,
  currentProcessStartTime,
} from '../../src/core/credentialLease'
import { credentialLeaseSecrets } from '../../src/host/models/modelsPanelBundle'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { UI_TEXT } from '../../src/shared/constants'
import { userFileIo } from '../../src/runtime/providersCommands'

/** A pid the liveness check really reports dead (past any real pid). */
const DEAD_PID = 2_147_483_647

function mapSecrets(): { store: SecretStore; writes: string[] } {
  const data = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    store: {
      get: (key) => Promise.resolve(data.get(key)),
      store: (key, value) => {
        writes.push(key)
        data.set(key, value)
        return Promise.resolve()
      },
      delete: (key) => {
        writes.push(key)
        data.delete(key)
        return Promise.resolve()
      },
    },
  }
}

describe('acquireCredentialLock', () => {
  const dirs: string[] = []
  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'credential-lease-'))
    dirs.push(dir)
    return dir
  }
  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    }
  })

  it('holds with an owner record and releases it', async () => {
    const dir = path.join(await freshDir(), 'providers.json.lock')
    const release = await acquireCredentialLock(dir)
    const owner = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8')) as {
      pid: number
    }
    expect(owner.pid).toBe(process.pid)
    await release()
    // Released: the next command acquires instead of wedging.
    const again = await acquireCredentialLock(dir)
    await again()
  })

  it('refuses while a live process holds the lock', async () => {
    const dir = path.join(await freshDir(), 'providers.json.lock')
    const release = await acquireCredentialLock(dir)
    await expect(acquireCredentialLock(dir)).rejects.toBeInstanceOf(CredentialLockBusyError)
    // The refusal removed nothing: the holder still owns its record.
    const owner = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8')) as {
      pid: number
    }
    expect(owner.pid).toBe(process.pid)
    await release()
  })

  it('reclaims a crashed owner instead of wedging', async () => {
    const dir = path.join(await freshDir(), 'providers.json.lock')
    // A holder that never releases: the directory and owner record a
    // SIGKILL leaves behind.
    await acquireCredentialLock(dir, { pid: DEAD_PID })
    const release = await acquireCredentialLock(dir)
    await release()
  })

  it('lets exactly one of two contenders take a crashed lock, keeping the winner', async () => {
    for (let round = 0; round < 6; round += 1) {
      const dir = path.join(await freshDir(), `round-${String(round)}.lock`)
      await acquireCredentialLock(dir, { pid: DEAD_PID })
      const [first, second] = await Promise.allSettled([
        acquireCredentialLock(dir),
        acquireCredentialLock(dir),
      ])
      const releases = [first, second].flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value] : [],
      )
      const busy = [first, second].filter(
        (outcome) =>
          outcome.status === 'rejected' && outcome.reason instanceof CredentialLockBusyError,
      )
      try {
        expect(releases).toHaveLength(1)
        expect(busy).toHaveLength(1)
        // The loser removed nothing: the winner's live record stands.
        const owner = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8')) as {
          pid: number
        }
        expect(owner.pid).toBe(process.pid)
      } finally {
        for (const release of releases) await release()
      }
    }
  })

  it('refuses an ownerless directory once its record lands during the settle', async () => {
    const dir = path.join(await freshDir(), 'providers.json.lock')
    // A holder between its mkdir and its owner write (both producers
    // write one now): the contender's first read sees nothing.
    await mkdir(dir, { recursive: false })
    const attempt = acquireCredentialLock(dir)
    await writeFile(
      path.join(dir, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        startTime: currentProcessStartTime(),
        nonce: 'holder',
      }),
    )
    await expect(attempt).rejects.toBeInstanceOf(CredentialLockBusyError)
    await rm(dir, { recursive: true, force: true })
  })

  describe('panel secrets guard', () => {
    it('runs panel credential writes inside the shared lease', async () => {
      const base = await freshDir()
      const lockDir = path.join(base, 'providers.json.lock')
      const { store, writes } = mapSecrets()
      const guarded = credentialLeaseSecrets(store, lockDir)
      await guarded.store('key', 'value')
      expect(await guarded.get('key')).toBe('value')
      expect(writes).toEqual(['key'])
      // No residue: each guarded write acquires and releases.
      await expect(readFile(path.join(lockDir, 'owner.json'), 'utf8')).rejects.toThrow()
      await guarded.delete('key')
      expect(await guarded.get('key')).toBeUndefined()
    })

    it('refuses a panel write while a Connect transaction holds the lease', async () => {
      const base = await freshDir()
      const lockDir = path.join(base, 'providers.json.lock')
      const { store } = mapSecrets()
      const guarded = credentialLeaseSecrets(store, lockDir)
      const release = await acquireCredentialLock(lockDir)
      try {
        await expect(guarded.store('key', 'value')).rejects.toThrow(UI_TEXT.providerConnectBusy)
        expect(await store.get('key')).toBeUndefined()
      } finally {
        await release()
      }
      await guarded.store('key', 'value')
      expect(await guarded.get('key')).toBe('value')
    })
  })

  it('sees the CLI file lock as a live owner, never a crashed acquisition', async () => {
    const base = await freshDir()
    const file = path.join(base, 'providers.json')
    const lockDir = `${file}.lock`
    const { withUserFileLock } = userFileIo(file)
    await withUserFileLock(async () => {
      // The CLI hold carries its owner from the start, so the extension
      // mistakes no live `providers connect` for a crash after 50 ms.
      const owner = JSON.parse(await readFile(path.join(lockDir, 'owner.json'), 'utf8')) as {
        pid: number
        startTime: number
        nonce: string
      }
      expect(owner.pid).toBe(process.pid)
      expect(typeof owner.startTime).toBe('number')
      expect(owner.nonce.length).toBeGreaterThan(0)
      await expect(acquireCredentialLock(lockDir)).rejects.toBeInstanceOf(CredentialLockBusyError)
      return 0
    })
    // Released with its record: the next holder acquires cleanly.
    const release = await acquireCredentialLock(lockDir)
    await release()
  })
})
