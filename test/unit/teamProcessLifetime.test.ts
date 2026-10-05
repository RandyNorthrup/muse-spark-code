import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTeamProcessLifetime,
  type LaunchConfirmation,
  type Retirement,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

const directories: string[] = []
const syncState = vi.hoisted(() => ({ shouldFail: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const open: typeof actual.open = async (target, flags, mode) => {
    const file = await actual.open(target, flags, mode)
    const sync = file.sync.bind(file)
    file.sync = async () => {
      if (syncState.shouldFail) throw new Error('fsync-failed')
      await sync()
    }
    return file
  }
  return { ...actual, open }
})
afterEach(async () => {
  syncState.shouldFail = false
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-k-')))
  directories.push(directory)
  const owner = createWindowIdentity(123)
  const recordTakeover = vi.fn(() => Promise.resolve())
  const authority = createWindowAuthority(owner, recordTakeover)
  const journal = createTeamJournal({
    storageDirectory: directory,
    authority,
    owner,
    maxRecordBytes: 1024 * 1024,
    platform: process.platform,
  })
  const journalDirectory = path.join(directory, 'team', 'journal', owner.instanceId)
  return { directory, owner, authority, journal, journalDirectory, recordTakeover }
}

const request = {
  command: process.execPath,
  args: [],
  cwd: process.cwd(),
  taskId: 'task-1',
  env: {},
  priority: 'belowNormal',
} as const

function driver(
  descendants: Retirement['descendants'] = 'proved',
  container: LaunchConfirmation['container'] = 'windowsJob',
) {
  const launch = vi.fn<TeamProcessDriver['launch']>(() => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: ['pipe', 'pipe', 'pipe'] })
    const ended = new Promise<Retirement>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => {
        resolve({ childExited: true, descendants })
      })
    })
    return {
      child,
      confirmation: Promise.resolve({
        pid: child.pid!,
        group: 'fixture-job',
        startTime: 'os-fixture-start',
        container,
      }),
      ended,
      retire: () => ended,
    }
  })
  return { launch }
}

describe('M96 K window ownership and journal', () => {
  it('never treats a duplicate window or a newer start as permission', async () => {
    const f = await fixture()
    const foreign = createWindowIdentity(124)
    expect(f.authority.canWrite(foreign)).toBe(false)
    expect(f.authority.canWrite({ ...f.owner, startedAt: 124 })).toBe(false)
    expect(await f.authority.takeOver(foreign, false)).toBe(false)
    expect(f.recordTakeover).not.toHaveBeenCalled()
    expect(() => {
      f.authority.assertCanWrite(foreign)
    }).toThrow('OWNER_UNCONFIRMED')
    await f.authority.takeOver(foreign, true)
    expect(f.recordTakeover).toHaveBeenCalledWith(foreign)
    expect(f.authority.canWrite(foreign)).toBe(true)
  })

  it('grants no takeover when its durable receipt fails', async () => {
    const f = await fixture()
    const foreign = createWindowIdentity(124)
    f.recordTakeover.mockRejectedValueOnce(new Error('disk-full'))
    await expect(f.authority.takeOver(foreign, true)).rejects.toThrow('disk-full')
    expect(f.authority.canWrite(foreign)).toBe(false)
  })

  it('writes and validates real files; refuses traversal and invalid state', async () => {
    const { journal, journalDirectory } = await fixture()
    const schema = z.strictObject({ tasks: z.array(z.string()) })
    await journal.write('board', { tasks: ['one'] }, schema)
    expect(await journal.read('board', schema)).toEqual({
      kind: 'record',
      value: { tasks: ['one'] },
    })
    expect(
      JSON.parse(await readFile(path.join(journalDirectory, 'board.json'), 'utf8')),
    ).toMatchObject({
      version: 1,
      value: { tasks: ['one'] },
    })
    await expect(journal.write('../outside', { tasks: [] }, schema)).rejects.toThrow()
    expect(await journal.read('missing', schema)).toEqual({ kind: 'missing' })
    expect(await journal.names()).toEqual(['board'])
  })

  it('moves only its own unreadable file aside, preserving exact bytes', async () => {
    const f = await fixture()
    const schema = z.string()
    await f.journal.write('board', 'valid', schema)
    await writeFile(path.join(f.journalDirectory, 'board.json'), '{broken')
    const result = await f.journal.read('board', schema)
    expect(result.kind).toBe('broken')
    if (result.kind !== 'broken') throw new Error('missing broken result')
    expect(result.wasMovedAside).toBe(true)
    expect(result.file.endsWith('.broken')).toBe(true)
    expect(await readFile(result.file, 'utf8')).toBe('{broken')
    expect(await f.journal.read('board', schema)).toEqual({ kind: 'missing' })
  })

  it('leaves another live window journal byte-exact until Take over', async () => {
    const f = await fixture()
    await f.journal.write('board', 'valid', z.string())
    const file = path.join(f.journalDirectory, 'board.json')
    await writeFile(file, '{broken')
    const outsider = createWindowAuthority(createWindowIdentity(456), () => Promise.resolve())
    const foreign = createTeamJournal({
      storageDirectory: f.directory,
      authority: outsider,
      owner: f.owner,
      maxRecordBytes: 4096,
      platform: process.platform,
    })
    await expect(foreign.write('board', 'overwritten', z.string())).rejects.toThrow(
      'OWNER_UNCONFIRMED',
    )
    expect(await foreign.read('board', z.string())).toEqual({
      kind: 'broken',
      file,
      wasMovedAside: false,
    })
    expect(await readFile(file, 'utf8')).toBe('{broken')
    expect(await readdir(f.journalDirectory)).toEqual(['board.json'])
  })
})

describe('M96 K launcher contract', () => {
  it('refuses a journal storage path through a link', async () => {
    const f = await fixture()
    const alias = path.join(f.directory, 'alias')
    await symlink(f.directory, alias, 'junction')
    const linked = createTeamJournal({
      storageDirectory: alias,
      authority: f.authority,
      owner: f.owner,
      maxRecordBytes: 4096,
      platform: process.platform,
    })
    await expect(linked.write('board', 'unsafe', z.string())).rejects.toThrow('PATH_CHANGED')
    expect(await f.journal.names()).toEqual([])
  })

  it('starts no process when the intent fsync fails', async () => {
    const f = await fixture()
    const d = driver()
    syncState.shouldFail = true
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: d,
      isHostBusy: () => false,
    })
    await expect(lifetime.launch(request)).rejects.toThrow('fsync-failed')
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('flushes intent before spawn, adds marker, then records OS confirmation and separate end', async () => {
    const f = await fixture()
    const real = driver()
    const observed: unknown[] = []
    const launch = vi.fn<TeamProcessDriver['launch']>((r, id) => {
      observed.push(r.env['MUSE_SPARK_LAUNCH_ID'])
      return real.launch(r, id)
    })
    const saved = vi.spyOn(f.journal, 'write')
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: { launch },
      isHostBusy: () => false,
    })
    const child = await lifetime.launch(request)
    expect(saved.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]!)
    expect(observed).toEqual([child.launchId])
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'belowNormal' }),
      child.launchId,
    )
    expect(saved.mock.calls[0]![1]).not.toHaveProperty('confirmation')
    await child.ended
    const contents = await readFile(
      path.join(f.journalDirectory, `launch-${child.launchId}.json`),
      'utf8',
    )
    expect(JSON.parse(contents)).toMatchObject({
      value: {
        confirmation: { startTime: 'os-fixture-start', group: 'fixture-job' },
        end: { childExited: true, descendants: 'proved' },
      },
    })
    expect(await lifetime.recoveryRecords(f.journal)).toEqual([])
  })

  it('starts no process when the intent cannot be written', async () => {
    const f = await fixture()
    const d = driver()
    vi.spyOn(f.journal, 'write').mockRejectedValueOnce(new Error('disk-full'))
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: d,
      isHostBusy: () => false,
    })
    await expect(lifetime.launch(request)).rejects.toThrow('disk-full')
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('rechecks load after the asynchronous intent and starts nothing under pressure', async () => {
    const f = await fixture()
    const d = driver()
    const isHostBusy = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const lifetime = createTeamProcessLifetime({ journal: f.journal, driver: d, isHostBusy })
    await expect(lifetime.launch(request)).rejects.toThrow('HOST_BUSY')
    expect(d.launch).not.toHaveBeenCalled()
    expect(await lifetime.recoveryRecords(f.journal)).toHaveLength(1)
  })

  it('dispose cannot miss a pending intent; no process is created after dispose', async () => {
    const f = await fixture()
    const d = driver()
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: d,
      isHostBusy: () => false,
    })
    const pending = lifetime.launch(request)
    const rejection = expect(pending).rejects.toThrow('DISPOSED')
    expect(await lifetime.dispose()).toEqual([{ childExited: false, descendants: 'uncertain' }])
    await rejection
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('keeps ended children without descendant proof in recovery', async () => {
    const f = await fixture()
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: driver('uncertain'),
      isHostBusy: () => false,
    })
    const child = await lifetime.launch(request)
    await child.ended
    expect(await lifetime.recoveryRecords(f.journal)).toMatchObject([
      { id: child.launchId, end: { childExited: true, descendants: 'uncertain' } },
    ])
    expect(await lifetime.dispose()).toEqual([{ childExited: true, descendants: 'uncertain' }])
  })

  it('rejects descendant proof from a process group', async () => {
    const f = await fixture()
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: driver('proved', 'processGroup'),
      isHostBusy: () => false,
    })
    const child = await lifetime.launch(request)
    await expect(child.ended).rejects.toThrow('RETIREMENT_PROOF_INVALID')
    expect(await lifetime.recoveryRecords(f.journal)).toHaveLength(1)
    await lifetime.dispose()
  })

  it('keeps a failed confirmation child available to dispose when retirement is uncertain', async () => {
    const f = await fixture()
    const real = driver('uncertain')
    const retire = vi.fn<() => Promise<Retirement>>()
    const launch: TeamProcessDriver['launch'] = (r, id) => {
      const child = real.launch(r, id)
      retire.mockImplementation(() => child.ended)
      return { ...child, confirmation: Promise.reject(new Error('confirmation-lost')), retire }
    }
    const lifetime = createTeamProcessLifetime({
      journal: f.journal,
      driver: { launch },
      isHostBusy: () => false,
    })
    await expect(lifetime.launch(request)).rejects.toThrow('confirmation-lost')
    expect(retire).toHaveBeenCalledTimes(1)
    expect(await lifetime.dispose()).toEqual([{ childExited: false, descendants: 'uncertain' }])
    expect(retire).toHaveBeenCalledTimes(2)
  })
})
