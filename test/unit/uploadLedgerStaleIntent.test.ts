// A failed provider delete leaves a durable intent; when the upload is used
// again and its last session is later released, the release reissues the
// delete at the current generation instead of dropping the stale intent and
// leaving a provider copy no intent names. A file something still holds keeps
// the old drop: use still beats intent.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  UploadLedger,
  type UploadLedgerDeps,
  type UploadLedgerState,
} from '../../src/core/media/uploadLedger'
import { fileUploadLedgerStorage } from '../../src/core/media/uploadLedgerStorage'

const accountId = 'e'.repeat(64)
const fileId = 'file-reissued'
const file = {
  fileId,
  provider: 'meta',
  expiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
  sha256: 'e'.repeat(64),
  bytes: 12,
  name: 'reissued.mp4',
  mime: 'video/mp4',
}

const shared: { scratch: string } = { scratch: '' }
afterAll(() => {
  if (shared.scratch !== '') rmSync(shared.scratch, { recursive: true, force: true })
})
beforeAll(() => {
  shared.scratch = mkdtempSync(path.join(process.env['TMPDIR'] ?? tmpdir(), 'ledger-reissue-'))
})

function ledger(tag: string, deletes: string[], failDeleteWith?: Error) {
  let failure = failDeleteWith
  const files: UploadLedgerDeps['files'] = {
    forAccount: () => files,
    upload: () => Promise.reject(new Error('no uploads here')),
    retrieve: () => Promise.resolve({}),
    accountFiles: () => Promise.resolve([]),
    delete: (id: string) => {
      deletes.push(id)
      if (failure !== undefined) {
        const error = failure
        failure = undefined
        return Promise.reject(error)
      }
      return Promise.resolve()
    },
  }
  const storage = fileUploadLedgerStorage(path.join(shared.scratch, tag, accountId))
  const store = new UploadLedger({
    storage,
    files,
    accountId,
    provider: 'meta',
    poolBytes: 100_000,
    currentAccountId: () => Promise.resolve(accountId),
    now: () => Date.now(),
  })
  return { store, storage }
}

// The storage port returns unknown by design; the ledger is the only writer,
// so this names the shape it just wrote rather than re-validating it.
async function readState(storage: { read(): Promise<unknown> }): Promise<UploadLedgerState> {
  return (await storage.read()) as UploadLedgerState
}

describe('upload ledger stale delete intents', () => {
  it('reissues the delete when the last session releases a reused upload', async () => {
    const deletes: string[] = []
    const { store, storage } = ledger('reissue', deletes, new Error('provider delete failed'))
    await storage.write({
      version: 1,
      accountId,
      entries: [{ file: { ...file }, sessions: ['s1'], useGen: 0 }],
      cachedFiles: [],
    })
    await expect(store.releaseSession('s1')).rejects.toThrow('provider delete failed')
    expect(deletes).toEqual([fileId])
    // The upload is used again, then its last session is released.
    await store.syncSession('s2', [{ ...file }])
    await store.releaseSession('s2')
    expect(deletes).toEqual([fileId, fileId])
    const state = await readState(storage)
    expect(state.entries).toEqual([])
    expect(state.pendingDeletes ?? []).toEqual([])
  })

  it('still drops a stale intent while a session holds the reused file', async () => {
    const deletes: string[] = []
    const { store, storage } = ledger('held', deletes)
    await storage.write({
      version: 1,
      accountId,
      entries: [{ file: { ...file }, sessions: ['s2'], useGen: 1 }],
      cachedFiles: [],
      pendingDeletes: [{ fileId, useGen: 0 }],
      pendingAttempts: { [fileId]: { fails: 1, nextRetry: 0 } },
    })
    await store.accountReport()
    expect(deletes).toEqual([])
    const state = await readState(storage)
    expect(state.entries).toHaveLength(1)
    expect(state.pendingDeletes ?? []).toEqual([])
  })
})
