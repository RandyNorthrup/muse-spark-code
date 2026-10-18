// The team stores' absent-data answers (D119): a missing directory reads
// as empty, never as a failure; anything else keeps its kind.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { usingTempDir } from './helpers/temporaryFolders'
import type { CoreLogger } from '../../src/core/logging'
import { TeamLedger } from '../../src/host/team/teamLedger'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

function log(): CoreLogger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

async function withMissingLedger(work: (ledger: TeamLedger) => Promise<void>) {
  await usingTempDir('pr161-team-', async (storage) => {
    const ledger = new TeamLedger({
      log: log(),
      directory: path.join(storage, 'missing'),
      workspaceId: 'ws',
      windowId: 'win-1',
      now: () => Date.now(),
      flushMs: 50,
      retentionDays: 1,
    })
    await work(ledger)
  })
}

describe('team store absence', () => {
  it('reads a missing ledger directory as empty', async () => {
    await withMissingLedger(async (ledger) => {
      await expect(ledger.read()).resolves.toEqual({ rows: [], skippedLines: 0 })
    })
  })

  it('prunes a missing ledger directory as nothing to do', async () => {
    await withMissingLedger(async (ledger) => {
      await expect(ledger.prune()).resolves.toEqual({ rolled: 0, removed: 0 })
    })
  })

  it('keeps a non-absent journal failure with its kind', async () => {
    await usingTempDir('pr161-team-', async (storage) => {
      const owner = createWindowIdentity(Date.now())
      mkdirSync(path.join(storage, 'team', 'journal'), { recursive: true })
      writeFileSync(path.join(storage, 'team', 'journal', owner.instanceId), 'not a directory')
      const journal = createTeamJournal({
        storageDirectory: storage,
        authority: createWindowAuthority(owner, () => Promise.resolve()),
        owner,
        maxRecordBytes: 1024,
        platform: process.platform,
      })
      let failure: unknown
      try {
        await journal.names()
        throw new Error('a journal file where the directory belongs must not list as empty')
      } catch (error: unknown) {
        failure = error
      }
      expect(failure instanceof Error && 'code' in failure && failure.code).toBe('ENOTDIR')
    })
  })
})
