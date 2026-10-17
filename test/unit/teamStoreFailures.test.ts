// The team stores' absent-data answers (D119): a missing directory reads
// as empty, never as a failure; anything else keeps its kind.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { TeamLedger } from '../../src/host/team/teamLedger'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr161-team-'))
  dirs.push(dir)
  return dir
}

function log(): CoreLogger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

describe('team store absence', () => {
  it('reads a missing ledger directory as empty', async () => {
    const ledger = new TeamLedger({
      log: log(),
      directory: path.join(folder(), 'missing'),
      workspaceId: 'ws',
      windowId: 'win-1',
      now: () => Date.now(),
      flushMs: 50,
      retentionDays: 1,
    })
    await expect(ledger.read()).resolves.toEqual({ rows: [], skippedLines: 0 })
  })

  it('prunes a missing ledger directory as nothing to do', async () => {
    const ledger = new TeamLedger({
      log: log(),
      directory: path.join(folder(), 'missing'),
      workspaceId: 'ws',
      windowId: 'win-1',
      now: () => Date.now(),
      flushMs: 50,
      retentionDays: 1,
    })
    await expect(ledger.prune()).resolves.toEqual({ rolled: 0, removed: 0 })
  })

  it('keeps a non-absent journal failure with its kind', async () => {
    const storage = folder()
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
    expect((failure as NodeJS.ErrnoException).code).toBe('ENOTDIR')
  })
})
