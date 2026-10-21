// The one credential lease (M95 D74): one owner per providers file across
// processes. A live lock is never stolen (a contender whose first read saw
// nothing still refuses once the owner's record lands), a crashed owner's
// lock never wedges the next command, a contender that already lost a
// takeover race never deletes the winner's live lock, and a contender that
// saw a crashed lock another window has since taken over never moves that
// window's live lock aside. All on real files, with real process-liveness
// checks; the other window is a real process running the real module.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  acquireCredentialLock,
  CredentialLockBusyError,
  currentProcessStartTime,
  isOwnerAlive,
  OWNER_FILE,
} from '../../src/core/credentialLease'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import { credentialLeaseSecrets } from '../../src/host/models/credentialLeaseSecrets'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { KEYRING_SERVICE, UI_TEXT } from '../../src/shared/constants'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import { userFileIo } from '../../src/runtime/providersCommands'

/** A pid the liveness check really reports dead (past any real pid). */
const DEAD_PID = 2_147_483_647
const LOCK_NAME = 'providers.json.lock'

/** The owner record a lock directory (or a tombstone) holds, as written. */
function ownerAt(dir: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, OWNER_FILE), 'utf8'))
}

/**
Waits until the filesystem's own clock has passed `folder`'s last change,
then returns the folder's modification time: any later change to its
entries (a rename, a create, a removal) shows as a newer one. The clock is
read from a probe written in `scratch`, a folder of its own, so `folder`
itself stays untouched.
*/
function folderTimeAfterTick(folder: string, scratch: string): bigint {
  const last = statSync(folder, { bigint: true }).mtimeNs
  const probe = path.join(scratch, 'tick')
  let ticks = 0
  let now = 0n
  while (now <= last) {
    ticks += 1
    writeFileSync(probe, String(ticks))
    now = statSync(probe, { bigint: true }).mtimeNs
  }
  return statSync(folder, { bigint: true }).mtimeNs
}

/**
The runtime's real secret store over the real OS credential store: the
keyring logic (parts, reclaim, per-account named locks) on a native
entry of a throwaway service, the same entry the product opens. Only
Windows rigs have a qualified native store (as in keyringParts.test.ts);
the guard itself is store-agnostic (the panel passes SecretStorage).
*/
async function testSecrets(
  scope: string,
): Promise<{ secrets: SecretStore; cleanup: () => Promise<void> }> {
  const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
  const service = `${KEYRING_SERVICE}.test.${scope}`
  const secrets = keyringSecretStore((_, name) => new AsyncEntry(service, name), {
    lockScope: scope,
  })
  return {
    secrets,
    cleanup: async () => {
      const remaining = await findCredentialsAsync(service)
      for (const entry of remaining) {
        await new AsyncEntry(service, entry.account).deletePassword()
      }
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
    // A crashed lock is taken over by exactly one contender: removal of
    // the stale lock is conditional on the moved record still being the
    // observed dead one, and the loser reports busy without removing the
    // winner's live lock. Background filesystem load keeps both
    // contenders' reads and writes overlapping so the stale-check/remove
    // interleaving is exercised in every run; all on real files with the
    // real process-liveness check.
    const churnDir = await freshDir()
    let shouldStopChurn = false
    const churn = async (id: number): Promise<void> => {
      const file = path.join(churnDir, `churn-${String(id)}.junk`)
      let count = 0
      while (!shouldStopChurn) {
        count += 1
        await writeFile(file, `payload-${String(count)}`.padEnd(4096, 'x'))
        await rm(file, { force: true })
      }
    }
    const churners = Array.from({ length: 8 }, (_, id) => churn(id))
    try {
      // Time-boxed, not round-counted: a slow machine races fewer rounds
      // but with wider interleaving windows, while a fast one runs many;
      // either way the test stays inside the repository's per-test timeout.
      const startedAt = Date.now()
      let round = 0
      while (Date.now() - startedAt < 3500 && round < 1200) {
        const dir = path.join(await freshDir(), `round-${String(round)}.lock`)
        round += 1
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
    } finally {
      shouldStopChurn = true
      await Promise.all(churners)
    }
  })

  it('refuses an ownerless directory once its record lands during the settle', async () => {
    const dir = path.join(await freshDir(), 'providers.json.lock')
    // A holder between its mkdir and its owner write (both producers
    // write one now): the contender's first read sees nothing.
    await mkdir(dir, { recursive: false })
    const attempt = acquireCredentialLock(dir)
    // Observe the refusal from this tick: the contender rejects during the
    // settle while the record write below is still in flight, and a later
    // `expect` alone leaves that rejection unhandled (an unhandled rejection
    // fails the shard even when every test passes).
    const refusal = expect(attempt).rejects.toBeInstanceOf(CredentialLockBusyError)
    await writeFile(
      path.join(dir, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        startTime: currentProcessStartTime(),
        nonce: 'holder',
      }),
    )
    await refusal
    await rm(dir, { recursive: true, force: true })
  })

  describe('a window that saw a crashed lock another window took first', () => {
    // The other window: a real process running the real module, built
    // from the source as the product's own bundle is. It acquires the
    // lock with the identity it is given and exits holding it, printing
    // the record it holds.
    let child = ''
    beforeAll(async () => {
      child = mkdtempSync(path.join(tmpdir(), 'credential-lease-child-'))
      await build({
        entryPoints: [path.join(process.cwd(), 'src/core/credentialLease.ts')],
        outfile: path.join(child, 'credentialLease.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      })
      writeFileSync(
        path.join(child, 'holder.cjs'),
        `const { readFileSync } = require('node:fs')
const path = require('node:path')
const { acquireCredentialLock, OWNER_FILE } = require('./credentialLease.cjs')
const [lockDir, pid] = process.argv.slice(2)
acquireCredentialLock(lockDir, { pid: Number(pid) }).then(
  () => { process.stdout.write(readFileSync(path.join(lockDir, OWNER_FILE), 'utf8')); process.exit(0) },
  (error) => { console.error(error); process.exit(1) },
)
`,
      )
    })
    afterAll(async () => {
      await rm(child, { recursive: true, force: true })
    })

    /**
    Window B, another real process: acquires `lockDir` (taking a crashed
    lock over with the real liveness check when one is there) under a live
    process id, this one's, with B's own start time, and exits without
    releasing. Synchronous, so it runs to completion inside window A's
    liveness check, between A's read of the dead owner and A's next step.
    */
    function holdInAnotherProcess(lockDir: string): unknown {
      const held = spawnSync(
        process.execPath,
        [path.join(child, 'holder.cjs'), lockDir, String(process.pid)],
        { env: withoutCredentials(process.env), encoding: 'utf8', windowsHide: true },
      )
      if (held.status !== 0) throw new Error(`window B did not acquire: ${held.stderr}`)
      return JSON.parse(held.stdout)
    }

    /**
    Window A's attempt on a crashed lock in `folder`. Right after A reads
    the dead owner, inside A's liveness check and before A's next step,
    `meanwhile` runs and window B acquires the lock and holds it. A must
    refuse, leaving B's exact record in B's own directory. Returns the dead
    record A read and the folder's modification time once B held the lock.
    */
    async function refusedAfterB(
      folder: string,
      meanwhile?: (lockDir: string) => void,
    ): Promise<{ readonly dead: unknown; readonly folderBefore: bigint }> {
      const scratch = await freshDir()
      const lockDir = path.join(folder, LOCK_NAME)
      // A crashed window's lock: its directory and owner record, owner dead.
      await acquireCredentialLock(lockDir, { pid: DEAD_PID })
      const dead = ownerAt(lockDir)
      let live: unknown
      let lockBefore: BigIntStats | undefined
      let folderBefore = 0n
      const isProcessAlive = (pid: number): boolean => {
        if (pid === DEAD_PID && live === undefined) {
          meanwhile?.(lockDir)
          live = holdInAnotherProcess(lockDir)
          lockBefore = lstatSync(lockDir, { bigint: true })
          folderBefore = folderTimeAfterTick(folder, scratch)
        }
        return isOwnerAlive(pid)
      }
      await expect(acquireCredentialLock(lockDir, { isProcessAlive })).rejects.toBeInstanceOf(
        CredentialLockBusyError,
      )
      expect(live).toBeDefined()
      // B still holds its lock: B's exact record, in the same directory.
      expect(ownerAt(lockDir)).toEqual(live)
      const lockAfter = lstatSync(lockDir, { bigint: true })
      expect(lockAfter.ino).toBe(lockBefore?.ino)
      expect(lockAfter.birthtimeNs).toBe(lockBefore?.birthtimeNs)
      return { dead, folderBefore }
    }

    it('refuses and never moves the live lock aside, even for a moment', async () => {
      const folder = await freshDir()
      // B takes the crashed lock over itself, after A read the dead owner.
      const { dead, folderBefore } = await refusedAfterB(folder)
      // A renamed, created and removed nothing beside the lock. A rename
      // keeps a directory's identity, so moving B's lock aside and putting
      // it back shows only here: while it was aside, a third window could
      // have claimed the lock's name and written beside B.
      expect(statSync(folder, { bigint: true }).mtimeNs).toBe(folderBefore)
      // Beside the lock lies only the crashed owner's tombstone, holding
      // the dead record; nothing else holds B's.
      const beside = readdirSync(folder).filter((name) => name !== LOCK_NAME)
      expect(beside.map((name) => ownerAt(path.join(folder, name)))).toEqual([dead])
    })

    it('puts back a lock that is not the dead one it saw, and keeps no tombstone of it', async () => {
      const folder = await freshDir()
      // Between A's read and A's move, a build from before the tombstone
      // takes the crashed lock over its way, removing the dead lock, and B
      // claims the free name. A moves B's lock, finds it is not the dead
      // record and puts the same directory back.
      await refusedAfterB(folder, (lockDir) => {
        rmSync(lockDir, { recursive: true, force: true })
      })
      // No tombstone keeps a live lock: nothing lies beside it.
      expect(readdirSync(folder)).toEqual([LOCK_NAME])
    })
  })

  describe.runIf(process.platform === 'win32')('panel secrets guard', () => {
    it('runs panel credential writes inside the shared lease', async () => {
      const base = await freshDir()
      const lockDir = path.join(base, 'providers.json.lock')
      const { secrets, cleanup } = await testSecrets(randomUUID())
      try {
        const guarded = credentialLeaseSecrets(secrets, lockDir)
        await guarded.store('key', 'value')
        expect(await guarded.get('key')).toBe('value')
        // No residue: each guarded write acquires and releases.
        await expect(readFile(path.join(lockDir, 'owner.json'), 'utf8')).rejects.toThrow()
        await guarded.delete('key')
        expect(await guarded.get('key')).toBeUndefined()
      } finally {
        await cleanup()
      }
    })

    it('refuses a panel write while a Connect transaction holds the lease', async () => {
      const base = await freshDir()
      const lockDir = path.join(base, 'providers.json.lock')
      const { secrets, cleanup } = await testSecrets(randomUUID())
      try {
        const guarded = credentialLeaseSecrets(secrets, lockDir)
        const release = await acquireCredentialLock(lockDir)
        try {
          await expect(guarded.store('key', 'value')).rejects.toThrow(UI_TEXT.providerConnectBusy)
          expect(await secrets.get('key')).toBeUndefined()
        } finally {
          await release()
        }
        await guarded.store('key', 'value')
        expect(await guarded.get('key')).toBe('value')
      } finally {
        await cleanup()
      }
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

  it('reclaims a crashed CLI lock instead of wedging every later command', async () => {
    const base = await freshDir()
    const file = path.join(base, 'providers.json')
    const { withUserFileLock } = userFileIo(file)
    // A CLI killed after its owner write but before its release: the lock
    // directory survives with a proven-dead owner.
    await acquireCredentialLock(`${file}.lock`, { pid: DEAD_PID })
    // The next terminal command reclaims the dead lock and runs inside it
    // (the old unconditional mkdir failed here with EEXIST indefinitely).
    const ran: number[] = []
    const result = await withUserFileLock(() => {
      ran.push(1)
      return Promise.resolve(7)
    })
    expect(result).toBe(7)
    expect(ran).toEqual([1])
  })
})
