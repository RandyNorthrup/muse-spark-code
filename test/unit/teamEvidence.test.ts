import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { usingTempDir } from './helpers/temporaryFolders'
import { silentCoreLog } from './helpers/memoryLogs'
import { safeParseLine, TeamLedger } from '../../src/host/team/teamLedger'
import { createTeamJournal, type TeamJournal } from '../../src/host/team/teamJournal'
import {
  createWindowAuthority,
  createWindowIdentity,
  type WindowIdentity,
} from '../../src/host/team/windowIdentity'
const localDayKey = (nowMs: number): string => {
  const date = new Date(nowMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('team ledger torn lines', () => {
  it('skips a malformed line instead of parsing it', () => {
    expect(safeParseLine('{torn')).toBe(undefined)
  })

  it('skips well-formed JSON that is not a ledger row', () => {
    expect(safeParseLine('{"version":1,"kind":"nope"}')).toBe(undefined)
  })

  it('counts a crashed writer’s partial tail as skipped, never fatal', async () => {
    await usingTempDir('pr161-team-', async (storage) => {
      const ledger = new TeamLedger({
        log: silentCoreLog(),
        directory: storage,
        workspaceId: 'ws',
        windowId: 'win-1',
        now: () => Date.now(),
        flushMs: 50,
        retentionDays: 0,
      })
      const owned = path.join(storage, 'win-1')
      mkdirSync(owned, { recursive: true })
      const dayFile = path.join(owned, `team-${localDayKey(Date.now())}.jsonl`)
      writeFileSync(dayFile, '{"version":1}\n{torn\n', 'utf8')
      await expect(ledger.read()).resolves.toEqual({ rows: [], skippedLines: 2 })
    })
  })
})

const makeJournal = (storage: string) => {
  const owner = createWindowIdentity(Date.now())
  const journal = createTeamJournal({
    storageDirectory: storage,
    authority: createWindowAuthority(owner, () => Promise.resolve()),
    owner,
    maxRecordBytes: 1024,
    platform: process.platform,
  })
  return { journal, owner }
}

const valueSchema = z.object({ text: z.string() })

/** A journal holding one kept note, with its owner and record folder. */
async function withKeptNote(
  prefix: string,
  work: (note: {
    storage: string
    journal: TeamJournal
    owner: WindowIdentity
    directory: string
  }) => Promise<void>,
): Promise<void> {
  await usingTempDir(prefix, async (storage) => {
    const { journal, owner } = makeJournal(storage)
    await journal.write('note', { text: 'kept' }, valueSchema)
    await work({
      storage,
      journal,
      owner,
      directory: path.join(storage, 'team', 'journal', owner.instanceId),
    })
  })
}

describe('team journal unreadable evidence', () => {
  it('keeps a torn record as broken evidence instead of throwing', async () => {
    await withKeptNote('pr161-team-', async ({ journal, directory }) => {
      const [file] = readdirSync(directory)
      if (file === undefined) throw new Error('the journal wrote no record file')
      writeFileSync(path.join(directory, file), '{torn', 'utf8')
      const read = await journal.read('note', valueSchema)
      expect(read.kind).toBe('broken')
    })
  })

  it('names a foreign window’s torn record without trusting it', async () => {
    await usingTempDir('pr161-team-', async (storage) => {
      const { journal } = makeJournal(storage)
      const foreignId = '223e4567-e89b-12d3-a456-426614174001'
      const foreignDirectory = path.join(storage, 'team', 'journal', foreignId)
      mkdirSync(foreignDirectory, { recursive: true })
      const torn = path.join(foreignDirectory, 'note.json')
      writeFileSync(torn, '{torn', 'utf8')
      const found = await journal.otherWindows()
      expect(found.unreadable).toContain(torn)
      const stored = readFileSync(torn, 'utf8')
      expect(stored).toBe('{torn')
    })
  })

  it('still journals after a torn record is preserved', async () => {
    await usingTempDir('pr161-team-', async (storage) => {
      const { journal, owner } = makeJournal(storage)
      const directory = path.join(storage, 'team', 'journal', owner.instanceId)
      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, 'note.json'), '{torn', 'utf8')
      await journal.write('later', { text: 'kept' }, valueSchema)
      const read = await journal.read('later', valueSchema)
      expect(read).toEqual({ kind: 'record', value: { text: 'kept' } })
    })
  })

  it('journals through a linked storage root instead of reporting it moved', async () => {
    await usingTempDir('pr161-team-link-', async (base) => {
      const real = path.join(base, 'real')
      mkdirSync(real, { recursive: true })
      const linked = path.join(base, 'linked')
      symlinkSync(real, linked, 'junction')
      const { journal } = makeJournal(linked)
      await journal.write('note', { text: 'kept' }, valueSchema)
      expect(await journal.read('note', valueSchema)).toEqual({
        kind: 'record',
        value: { text: 'kept' },
      })
      await expect(journal.names()).resolves.toEqual(['note'])
    })
  })

  it('reads a record swapped for a link as broken without following it', async () => {
    await withKeptNote('pr161-team-link-', async ({ storage, journal, owner, directory }) => {
      const foreign = path.join(storage, 'foreign.json')
      writeFileSync(
        foreign,
        JSON.stringify({ version: 1, owner, value: { text: 'foreign' } }),
        'utf8',
      )
      symlinkSync(foreign, path.join(directory, 'linked.json'), 'junction')
      const read = await journal.read('linked', valueSchema)
      expect(read.kind).toBe('broken')
      expect(readFileSync(foreign, 'utf8')).toBe(
        JSON.stringify({ version: 1, owner, value: { text: 'foreign' } }),
      )
    })
  })
})
