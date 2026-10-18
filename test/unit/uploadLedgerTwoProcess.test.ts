// Round 4, P2-8: the rulings that need two processes get a test with two
// real OS processes over real on-disk state through the real cross-process
// file lease. Each test fails with the round-3 plain-set pins: a foreign
// unpin would release the holder, and a dead holder would pin forever.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import {
  UploadLedger,
  type UploadLedgerDeps,
  type UploadLedgerState,
} from '../../src/core/media/uploadLedger'
import { fileUploadLedgerStorage } from '../../src/core/media/uploadLedgerStorage'
import { systemBootId } from '../../src/core/locks/processOwner'

const accountId = 'c'.repeat(64)
const fileId = 'file-shared'
const sharedFile = {
  fileId,
  provider: 'meta',
  expiresAt: 4_600_000,
  sha256: 'd'.repeat(64),
  bytes: 12,
  name: 'shared.mp4',
  mime: 'video/mp4',
}

const shared: { scratch: string; bundle: string } = { scratch: '', bundle: '' }
const children: ChildProcess[] = []
afterAll(() => {
  for (const child of children) child.kill()
  if (shared.scratch !== '') rmSync(shared.scratch, { recursive: true, force: true })
})

beforeAll(() => {
  // The child entry is bundled once: one esbuild run serves both tests.
  shared.scratch = mkdtempSync(path.join(process.env['TMPDIR'] ?? tmpdir(), 'ledger-two-proc-'))
  shared.bundle = path.join(shared.scratch, 'ledger-child.mjs')
  buildSync({
    entryPoints: [path.resolve('test/unit/helpers/media/ledgerChild.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: shared.bundle,
    logLevel: 'silent',
  })
})

function seedState(): UploadLedgerState {
  return {
    version: 1,
    accountId,
    entries: [{ file: { ...sharedFile }, sessions: [], useGen: 0 }],
    cachedFiles: [],
  }
}

function parentLedger(deletes: string[]): UploadLedger {
  const files: UploadLedgerDeps['files'] = {
    forAccount: () => files,
    upload: () => Promise.reject(new Error('the parent never uploads here')),
    retrieve: () => Promise.resolve({}),
    accountFiles: () => Promise.resolve([]),
    delete: (id: string) => {
      deletes.push(id)
      return Promise.resolve()
    },
  }
  return new UploadLedger({
    storage: fileUploadLedgerStorage(path.join(shared.scratch, accountId)),
    files,
    accountId,
    provider: 'meta',
    poolBytes: 100_000,
    currentAccountId: () => Promise.resolve(accountId),
    now: () => Date.now(),
  })
}

/** Spawns the bundled child; resolves once it signals readiness. */
async function spawnChild(
  action: string,
  readyFile: string,
  stopFile: string,
  doneFile: string,
): Promise<{
  readonly child: ChildProcess
  readonly stderr: () => string
  readonly exited: Promise<number | null>
}> {
  let stderr = ''
  const child = spawn(process.execPath, [shared.bundle], {
    env: {
      ...process.env,
      LEDGER_CHILD_DIR: path.join(shared.scratch, accountId),
      LEDGER_CHILD_ACCOUNT: accountId,
      LEDGER_CHILD_FILE: fileId,
      LEDGER_CHILD_ACTION: action,
      LEDGER_CHILD_READY: readyFile,
      LEDGER_CHILD_STOP: stopFile,
      LEDGER_CHILD_DONE: doneFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  // A crash child can exit before readiness is even observed: track the
  // exit from spawn, never after.
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', () => {
      resolve(null)
    })
    child.on('close', (code) => {
      resolve(code)
    })
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const deadline = Date.now() + 10_000
  while (!existsSync(readyFile)) {
    if (child.exitCode !== null) throw new Error(`the child exited before readiness: ${stderr}`)
    if (Date.now() > deadline) throw new Error(`the child never signalled: ${stderr}`)
    await new Promise((settle) => setTimeout(settle, 20))
  }
  return { child, stderr: () => stderr, exited }
}

async function waitFor(file: string, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${stderr()}`)
    await new Promise((settle) => setTimeout(settle, 20))
  }
}

/** A seeded parent ledger plus a spawned child holder, keyed by `tag`. */
async function seededChild(tag: string, action: string) {
  const deletes: string[] = []
  const ledger = parentLedger(deletes)
  const storage = fileUploadLedgerStorage(path.join(shared.scratch, accountId))
  await storage.write(seedState())
  const ready = path.join(shared.scratch, `ready-${tag}`)
  const stop = path.join(shared.scratch, `stop-${tag}`)
  const done = path.join(shared.scratch, `done-${tag}`)
  const spawned = await spawnChild(action, ready, stop, done)
  return { deletes, ledger, ready, stop, done, ...spawned }
}

describe('upload ledger across two real processes', () => {
  it('holds a second process pin across this process unpin, then lets go', async () => {
    const { deletes, ledger, stop, done, stderr } = await seededChild('1', 'hold')
    // Our own pin cycle must not release the other process's reference.
    await ledger.pinFiles([fileId], 'parent-owner')
    await ledger.unpinFiles([fileId], 'parent-owner')
    await expect(ledger.deleteFile(fileId, () => Promise.resolve(true))).rejects.toThrow(
      'in use by a running request',
    )
    expect(deletes).toEqual([])
    writeFileSync(stop, 'stop')
    await waitFor(done, stderr)
    await ledger.deleteFile(fileId, () => Promise.resolve(true))
    expect(deletes).toEqual([fileId])
  })

  it('releases the references of a process proven gone', async () => {
    const { deletes, ledger, stderr, exited } = await seededChild('2', 'crash')
    // The holder pinned and exited without unpinning, like a crash.
    const code = await exited
    if (code !== 0) throw new Error(`the crashed child exited ${String(code)}: ${stderr()}`)
    // The next pin run reaps the gone process, so the delete proceeds.
    await ledger.pinFiles([fileId], 'parent-owner')
    await ledger.unpinFiles([fileId], 'parent-owner')
    await ledger.deleteFile(fileId, () => Promise.resolve(true))
    expect(deletes).toEqual([fileId])
  })

  it('reaps a pin whose birth no longer matches its live id', async () => {
    const { deletes, ledger, stop, done, stderr, child } = await seededChild('3', 'hold')
    const holder = child.pid
    if (holder === undefined) throw new Error('the holder has no pid')
    // A pin the crashed process left behind, now shadowed by the live holder
    // the system gave the recycled id to: the birth proves it is not the owner.
    const bootId = await systemBootId()
    const storage = fileUploadLedgerStorage(path.join(shared.scratch, accountId))
    await storage.write({
      ...seedState(),
      pinned: [
        {
          fileId,
          owner: `${String(holder)}:stale-owner`,
          processStart: 1,
          ...(bootId !== undefined && { bootId }),
        },
      ],
    })
    await ledger.pinFiles([fileId], 'parent-owner')
    await ledger.unpinFiles([fileId], 'parent-owner')
    await ledger.deleteFile(fileId, () => Promise.resolve(true))
    expect(deletes).toEqual([fileId])
    writeFileSync(stop, 'stop')
    await waitFor(done, stderr)
  })
})
