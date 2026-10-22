// M96d durable custody: real stores, real owner records, real
// processes. Needs native process birth (`ps` on macOS, /proc on
// Linux, the sealed reader on Windows); where the sandbox denies the
// birth inquiry, open refuses and these tests fail at open.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COORDINATOR_LEDGER_MAX_BYTES } from '../../src/shared/constants'
import { exactProcessBirth, systemBootIdentity } from '../../src/core/locks/processOwner'
import { canReadProcessBirth } from './helpers/processBirth'
import {
  isCoordinatorLedgerError,
  openCoordinatorLedger,
  type CoordinatorLedger,
  type CoordinatorLedgerRefusal,
} from '../../src/core/team/coordinator/ledger'
import type { CoordinatorReference } from '../../src/core/team/coordinator/references'

const resources = ['worker', 'processWorker', 'heavyCommand', 'singleton', 'landing'] as const
const reference: CoordinatorReference = {
  platform: 'linux',
  kind: 'pidfd',
  token: 'held-reference-A',
  boot: 'boot-A',
  start: '1000001',
  pid: 42,
  validated: true,
  exited: false,
}
const retiredReference: CoordinatorReference = { ...reference, exited: true }

const stores: string[] = []
const ledgers: CoordinatorLedger[] = []

afterEach(async () => {
  for (const ledger of ledgers.splice(0)) {
    try {
      await ledger.close()
    } catch {
      // Already closed inside the test.
    }
  }
  for (const directory of stores.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function openLedger(): Promise<{ ledger: CoordinatorLedger; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'm96d-store-'))
  stores.push(directory)
  const ledger = await openCoordinatorLedger(directory, randomUUID())
  ledgers.push(ledger)
  return { ledger, directory }
}

async function refusalOf(operation: Promise<unknown>): Promise<CoordinatorLedgerRefusal> {
  try {
    await operation
  } catch (error: unknown) {
    if (isCoordinatorLedgerError(error)) return error.code
    throw error
  }
  throw new Error('Expected the ledger to refuse')
}

describe('M96d durable custody', () => {
  if (canReadProcessBirth()) {
    it('refuses a second live owner and yields to a provably dead one', async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'm96d-store-'))
      stores.push(directory)
      const ledger = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(ledger)
      await ledger.reserve('grant-A', 'window-A', [...resources])
      // Our own live record refuses a second custody in this process.
      expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe('owned')
      await ledger.close()
      if (process.platform === 'linux' || process.platform === 'win32') {
        // Precise native births make the foreign-owner case deterministic:
        // a live foreign PID refuses, its death yields.
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
          stdio: 'ignore',
        })
        try {
          const pid = child.pid
          if (pid === undefined) throw new Error('Expected a child PID')
          const birth = await exactProcessBirth(pid)
          const boot = await systemBootIdentity()
          if (birth === undefined || boot === undefined) throw new Error('Expected child birth')
          await writeFile(
            path.join(directory, 'owner.json'),
            JSON.stringify({ pid, birth, boot, epoch: randomUUID() }),
          )
          expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe('owned')
          child.kill('SIGKILL')
          await new Promise<void>((resolve) => {
            child.once('exit', () => {
              resolve()
            })
          })
          const recovered = await openCoordinatorLedger(directory, randomUUID())
          ledgers.push(recovered)
          expect(recovered.held('grant-A')).toEqual([...resources])
          expect(recovered.retirementState('grant-A')).toBe('unknown')
          await recovered.close()
        } finally {
          child.kill('SIGKILL')
        }
      }
      // A PID that never lived yields on every platform, deterministically.
      // (The birth value is schema filler, never evidence: the inquiry
      // finds no such process before any comparison runs.)
      const boot = await systemBootIdentity()
      if (boot === undefined) throw new Error('Expected a boot identity')
      await writeFile(
        path.join(directory, 'owner.json'),
        JSON.stringify({ pid: 4_194_303, birth: 'stale-birth', boot, epoch: randomUUID() }),
      )
      const recovered = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(recovered)
      expect(recovered.held('grant-A')).toEqual([...resources])
      await recovered.close()
    })

    it('blocks on torn, oversized, mismatched or malformed records, keeping the evidence', async () => {
      const { ledger, directory } = await openLedger()
      await ledger.reserve('grant-A', 'window-A', [...resources])
      await ledger.close()
      const ledgerPath = path.join(directory, 'ledger.json')
      const saved = await readFile(ledgerPath, 'utf8')
      try {
        await writeFile(
          path.join(directory, 'owner.json'),
          JSON.stringify({ pid: 0, birth: '', boot: '', epoch: '' }),
        )
        expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe(
          'ambiguousStore',
        )
        await rm(path.join(directory, 'owner.json'), { force: true })
        await writeFile(ledgerPath, '{"grants": [torn')
        expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe(
          'ambiguousStore',
        )
        await writeFile(ledgerPath, 'x'.repeat(COORDINATOR_LEDGER_MAX_BYTES + 1))
        expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe(
          'storeTooLarge',
        )
        const parsed = JSON.parse(saved) as { storeId: string }
        await writeFile(ledgerPath, JSON.stringify({ ...parsed, storeId: 'another-store' }))
        expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe(
          'identityMismatch',
        )
        await writeFile(ledgerPath, JSON.stringify({ storeId: 42, grants: 'grants' }))
        expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe(
          'ambiguousStore',
        )
      } finally {
        await writeFile(ledgerPath, saved)
        await rm(path.join(directory, 'owner.json'), { force: true })
      }
      // The evidence survived: the store opens once the damage is repaired.
      const recovered = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(recovered)
      expect(recovered.held('grant-A')).toEqual([...resources])
      await recovered.close()
    })

    it('refuses a reused epoch, an ambiguous initialisation and a linked store', async () => {
      const { ledger, directory } = await openLedger()
      const epoch = ledger.epoch
      await ledger.close()
      expect(await refusalOf(openCoordinatorLedger(directory, epoch))).toBe('epochReused')
      const bare = await mkdtemp(path.join(tmpdir(), 'm96d-bare-'))
      stores.push(bare)
      await writeFile(path.join(bare, 'ledger.json'), '{"storeId":"x"}')
      expect(await refusalOf(openCoordinatorLedger(bare, randomUUID()))).toBe('ambiguousStore')
      if (process.platform === 'win32') return
      const link = path.join(tmpdir(), `m96d-link-${randomUUID()}`)
      stores.push(link)
      await symlink(directory, link)
      expect(await refusalOf(openCoordinatorLedger(link, randomUUID()))).toBe('ambiguousStore')
    })

    it('a failed sync refuses while the previous synced state stands', async () => {
      const { ledger, directory } = await openLedger()
      await ledger.reserve('grant-A', 'window-A', [...resources])
      // With the store directory gone, the intent cannot publish: the
      // operation refuses and the grant stays reserved, never half-intended.
      await rm(directory, { recursive: true, force: true })
      expect(await refusalOf(ledger.persistIntent('grant-A'))).toBe('syncFailed')
      expect(ledger.held('grant-A')).toEqual([...resources])
      await ledger.close()
      const recovered = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(recovered)
      expect(recovered.held('grant-A')).toEqual([])
    })

    it('journals every transition: a reopened store retains grants and tombstones', async () => {
      const { ledger, directory } = await openLedger()
      await ledger.reserve('grant-A', 'window-A', [...resources])
      await ledger.persistIntent('grant-A')
      await ledger.spawn('grant-A')
      await ledger.register('grant-A', reference, 'complete')
      await ledger.reserve('grant-B', 'window-B', ['other'])
      await ledger.persistIntent('grant-B')
      await ledger.spawn('grant-B')
      await ledger.register('grant-B', reference, 'complete')
      expect(
        await ledger.settle({
          grant: 'grant-B',
          epoch: ledger.epoch,
          reference: retiredReference,
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('released')
      expect(ledger.outcomeOf('grant-B')).toEqual({
        epoch: ledger.epoch,
        token: retiredReference.token,
      })
      await ledger.close()
      const recovered = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(recovered)
      expect(recovered.held('grant-A')).toEqual([...resources])
      expect(recovered.retirementState('grant-A')).toBe('unknown')
      expect(recovered.held('grant-B')).toEqual([])
      expect(recovered.outcomeOf('grant-B')).toEqual({
        epoch: ledger.epoch,
        token: retiredReference.token,
      })
      // The tombstone survives until acknowledged and collected, never before.
      expect(await recovered.collectAcknowledged()).toEqual([])
      expect(await recovered.acknowledgeSettled('grant-B')).toBe(true)
      expect(await recovered.collectAcknowledged()).toEqual(['grant-B'])
      await recovered.close()
      const third = await openCoordinatorLedger(directory, randomUUID())
      ledgers.push(third)
      expect(third.held('grant-A')).toEqual([...resources])
      expect(third.outcomeOf('grant-B')).toBeUndefined()
      await third.close()
    })
  } else {
    // The table is silent here (this lane's sandbox denies macOS `ps`):
    // custody refuses, said, and leaves no owner claim behind.
    it('refuses custody while process birth is unreadable', async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'm96d-store-'))
      stores.push(directory)
      expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe('ownerUncertain')
      await expect(readFile(path.join(directory, 'owner.json'))).rejects.toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      )
      expect(await refusalOf(openCoordinatorLedger(directory, randomUUID()))).toBe('ownerUncertain')
    })
  }
})
