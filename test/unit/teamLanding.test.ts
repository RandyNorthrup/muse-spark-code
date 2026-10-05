import { chmod, readFile, readdir, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamLanding, type LandingIntent, type LandingOutcome } from '../../src/core/team/teamMerge'
import { knownRepositoryHolder } from '../../src/host/team/gitIndexLock'
import { LandingJournal, landingFileAccess } from '../../src/host/team/landingJournal'
import { teamRepository } from './helpers/teamRepository'
import { teamLandingFixture } from './helpers/teamLanding'

describe('snapshot-bound landing and recovery', () => {
  let repo: Awaited<ReturnType<typeof teamRepository>>
  beforeEach(async () => {
    repo = await teamRepository()
  })
  afterEach(async () => {
    await repo.dispose()
  })

  it('lands and undoes an indexed executable on a permission-blind checkout', async () => {
    await repo.permissionBlindExecutable()
    const fixture = await teamLandingFixture(repo, { 'run.sh': '#!/bin/sh\nexit 1\n' })
    expect(await fixture.access.read('run.sh')).toMatchObject({ mode: '100755' })
    const result = await fixture.landing.land(repo.root, fixture.admission)
    expect(result.status).toBe('landed')
    if (result.status !== 'landed') throw new Error('expected landing')
    expect(await fixture.landing.undo(result.intent, null)).toMatchObject({ status: 'landed' })
    expect(await readFile(path.join(repo.root, 'run.sh'), 'utf8')).toBe('#!/bin/sh\nexit 0\n')
    expect(await fixture.access.read('run.sh')).toMatchObject({ mode: '100755' })
  })

  it('checks holders immediately before deleting a matching file', async () => {
    const fixture = await teamLandingFixture(repo)
    const before = await fixture.access.read('a.txt')
    const lock = await fixture.deps.takeLock(repo.root, 'deletion')
    if (lock === null) throw new Error('expected lock')
    const writeGuard = vi.fn(async () => {
      await repo.write('.git/CHERRY_PICK_HEAD', 'operation')
      return (await fixture.deps.knownHolder(repo.root, lock)) === undefined
    })
    try {
      expect(await fixture.access.replace('a.txt', before, null, writeGuard)).toBe(false)
      expect(writeGuard).toHaveBeenCalledOnce()
      expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
    } finally {
      await lock.release()
    }
  })

  it.each(['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'])(
    'defers an operation appearing during lock acquisition: %s',
    async (operation) => {
      const fixture = await teamLandingFixture(repo)
      const replace = vi.fn(fixture.deps.replace)
      const landing = new TeamLanding({
        ...fixture.deps,
        takeLock: async (root, id) => {
          const lock = await fixture.deps.takeLock(root, id)
          await repo.write(
            `.git/${operation}${operation.startsWith('rebase-') ? '/marker' : ''}`,
            'operation',
          )
          return lock
        },
        replace,
      })
      expect(await landing.land(repo.root, fixture.admission)).toMatchObject({ status: 'branched' })
      expect(replace).not.toHaveBeenCalled()
      expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
      await expect(readFile(path.join(fixture.gitDirectory, 'index.lock'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('stops landing writes when an operation appears after the first file', async () => {
    const fixture = await teamLandingFixture(repo, { 'a.txt': 'new-a\n', 'b.txt': 'new-b\n' })
    const replace = vi.fn<typeof fixture.deps.replace>(async (root, file, canWrite) => {
      const isReplaced = await fixture.deps.replace(root, file, canWrite)
      await repo.write('.git/rebase-merge/marker', 'operation')
      return isReplaced
    })
    const landing = new TeamLanding({ ...fixture.deps, replace })
    expect(await landing.land(repo.root, fixture.admission)).toMatchObject({
      status: 'changed',
      paths: ['b.txt'],
    })
    expect(await readFile(path.join(repo.root, 'b.txt'), 'utf8')).toBe('base-b\n')
    expect(replace).toHaveBeenCalledOnce()
  })

  it.each(['recover', 'undo'] as const)(
    'refuses %s when an operation arrives during lock acquisition',
    async (action) => {
      const fixture = await teamLandingFixture(repo)
      const result = await fixture.landing.land(repo.root, fixture.admission)
      if (result.status !== 'landed') throw new Error('expected landing')
      const landing = new TeamLanding({
        ...fixture.deps,
        takeLock: async (root, id) => {
          const lock = await fixture.deps.takeLock(root, id)
          await repo.write('.git/rebase-apply/marker', 'operation')
          return lock
        },
      })
      expect(
        await (action === 'recover'
          ? landing.recover(result.intent)
          : landing.undo(result.intent, null)),
      ).toMatchObject({ status: 'busy' })
      expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('landed-a\n')
    },
  )

  it.each(['land', 'recover', 'undo'] as const)(
    'rechecks holders at the final staged-file guard for %s',
    async (action) => {
      const fixture = await teamLandingFixture(repo)
      let intent: LandingIntent | undefined
      if (action !== 'land') {
        const landed = await fixture.landing.land(repo.root, fixture.admission)
        if (landed.status !== 'landed') throw new Error('expected landing')
        intent = landed.intent
      }
      let didInsert = false
      const access = landingFileAccess(repo.root, repo.staging, {
        validateTarget: async () => {
          if (didInsert) return
          const names = await readdir(repo.root)
          if (names.every((name) => !name.startsWith('a.txt.'))) return
          didInsert = true
          await repo.write('.git/MERGE_HEAD', 'operation')
        },
      })
      const landing = new TeamLanding({
        ...fixture.deps,
        replace: (_root, file, canWrite) =>
          access.replace(file.path, file.before, file.after, canWrite),
        recover: (record, canWrite) => fixture.journal.recover(record, access, canWrite),
        undo: (record, task, canWrite) => fixture.journal.undo(record, task, access, canWrite),
      })
      let outcome: LandingOutcome
      if (action === 'land') outcome = await landing.land(repo.root, fixture.admission)
      else {
        if (intent === undefined) throw new Error('expected intent')
        outcome =
          action === 'recover' ? await landing.recover(intent) : await landing.undo(intent, null)
      }
      expect(outcome).toMatchObject({ status: 'changed', paths: ['a.txt'] })
      expect(didInsert).toBe(true)
      expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe(
        action === 'land' ? 'base-a\n' : 'landed-a\n',
      )
    },
  )

  it('lands the tested blobs uncommitted, journals first and keeps the user index untouched', async () => {
    const fixture = await teamLandingFixture(repo)
    const index = await readFile(path.join(fixture.gitDirectory, 'index'))
    const landing = new TeamLanding({
      ...fixture.deps,
      replace: async (_root, file, canWrite) => {
        expect(await fixture.journal.read('landing-one')).toMatchObject({ status: 'open' })
        expect(await readFile(path.join(fixture.gitDirectory, 'index.lock'), 'utf8')).toContain(
          'window-one',
        )
        return await fixture.access.replace(file.path, file.before, file.after, canWrite)
      },
    })
    await repo.write('a.txt', 'corrupted staging after checks\n', fixture.copy)
    const result = await landing.land(repo.root, fixture.admission)
    expect(result.status).toBe('landed')
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('landed-a\n')
    expect(await repo.staging.head(repo.root)).toBe(fixture.admission.snapshot.head)
    expect(await readFile(path.join(fixture.gitDirectory, 'index'))).toEqual(index)
    expect(await fixture.journal.read('landing-one')).toMatchObject({ status: 'landed' })
    await expect(readFile(path.join(fixture.gitDirectory, 'index.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('invalidates untouched dependency changes and changed check identities before writing', async () => {
    const fixture = await teamLandingFixture(repo)
    await repo.write('b.txt', 'changed dependency\n')
    expect(await fixture.landing.land(repo.root, fixture.admission)).toMatchObject({
      status: 'stale',
    })
    await repo.write('b.txt', 'base-b\n')
    const landing = new TeamLanding({
      ...fixture.deps,
      checkIdentity: () => Promise.resolve('checks-two'),
    })
    expect(await landing.land(repo.root, fixture.admission)).toMatchObject({ status: 'stale' })
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
    expect(fixture.deps.invalidate).toHaveBeenCalledTimes(2)
  })

  it('lands and undoes raw binary additions and deletions with executable modes', async () => {
    const bytes = Buffer.from([0, 255, 128, 1])
    const fixture = await teamLandingFixture(repo, { 'a.txt': 'changed\n', 'binary.bin': bytes })
    await rm(path.join(fixture.copy, 'b.txt'))
    if (process.platform !== 'win32') await chmod(path.join(fixture.copy, 'a.txt'), 0o755)
    const final = await repo.staging.snapshot(fixture.copy)
    await repo.git(['fetch', '--no-tags', '--no-write-fetch-head', fixture.copy, final.commit])
    const owners = new Map(fixture.admission.owners)
    owners.set('b.txt', ['task-one'])
    const result = await fixture.landing.land(repo.root, { ...fixture.admission, final, owners })
    expect(result.status).toBe('landed')
    expect(await readFile(path.join(repo.root, 'binary.bin'))).toEqual(bytes)
    await expect(readFile(path.join(repo.root, 'b.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform !== 'win32') {
      const landed = await repo.staging.snapshot(repo.root)
      expect(landed.blobs.get('a.txt')?.mode).toBe('100755')
    }
    if (result.status !== 'landed') throw new Error('expected landing')
    expect(await fixture.landing.undo(result.intent, null)).toMatchObject({ status: 'landed' })
    expect(await readFile(path.join(repo.root, 'b.txt'), 'utf8')).toBe('base-b\n')
    await expect(readFile(path.join(repo.root, 'binary.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const restored = await repo.staging.snapshot(repo.root)
    expect(restored.blobs.get('a.txt')?.mode).toBe('100644')
  })

  it('excludes overlapping in-process landings and makes real git add meet the lock', async () => {
    const fixture = await teamLandingFixture(repo)
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const landing = new TeamLanding({
      ...fixture.deps,
      replace: async (_root, file, canWrite) => {
        entered.resolve(undefined)
        await resume.promise
        return await fixture.access.replace(file.path, file.before, file.after, canWrite)
      },
    })
    const first = landing.land(repo.root, fixture.admission)
    await entered.promise
    try {
      expect(await landing.land(repo.root, fixture.admission)).toMatchObject({ status: 'busy' })
      await expect(repo.git(['add', 'a.txt'])).rejects.toThrow('index.lock')
    } finally {
      resume.resolve(undefined)
    }
    expect(await first).toMatchObject({ status: 'landed' })
  })

  it('defers a known holder to a landing branch and Apply rebuilds from a fresh snapshot', async () => {
    const fixture = await teamLandingFixture(repo)
    await repo.write('.git/rebase-merge/head-name', 'main')
    const index = await readFile(path.join(fixture.gitDirectory, 'index'))
    const result = await fixture.landing.land(repo.root, fixture.admission)
    expect(result.status).toBe('branched')
    expect(await repo.git(['show', 'refs/heads/agents/landing/landing-one:a.txt'])).toBe('landed-a')
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
    expect(await readFile(path.join(fixture.gitDirectory, 'index'))).toEqual(index)
    await rm(path.join(fixture.gitDirectory, 'rebase-merge'), { recursive: true })
    await repo.write('b.txt', 'new dependency\n')
    const rebuild = vi.fn(async () => {
      const rebuilt = await teamLandingFixture(repo, { 'a.txt': 'landed-a\n' }, 'apply-one')
      return rebuilt.admission
    })
    expect(await fixture.landing.apply(repo.root, 'landing-one', rebuild)).toMatchObject({
      status: 'landed',
    })
    expect(rebuild).toHaveBeenCalledWith('landing-one')
    expect(await readFile(path.join(repo.root, 'b.txt'), 'utf8')).toBe('new dependency\n')
  })

  it('asks separately for Land without checks in every mode', async () => {
    const fixture = await teamLandingFixture(repo)
    expect(await fixture.landing.land(repo.root, fixture.admission, true)).toMatchObject({
      status: 'denied',
    })
    expect(fixture.deps.confirmWithoutChecks).toHaveBeenCalledOnce()
    const consent = vi.fn().mockResolvedValue(true)
    const landing = new TeamLanding({ ...fixture.deps, confirmWithoutChecks: consent })
    expect(await landing.land(repo.root, fixture.admission, true)).toMatchObject({
      status: 'landed',
    })
    expect(consent).toHaveBeenCalledOnce()
  })

  it('refuses a per-file byte change immediately before replacement and leaves the user edit', async () => {
    const fixture = await teamLandingFixture(repo)
    const landing = new TeamLanding({
      ...fixture.deps,
      replace: async (_root, file, canWrite) => {
        await repo.write('a.txt', 'user edit\n')
        return await fixture.access.replace(file.path, file.before, file.after, canWrite)
      },
    })
    expect(await landing.land(repo.root, fixture.admission)).toMatchObject({
      status: 'changed',
      paths: ['a.txt'],
    })
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('user edit\n')
  })

  it('rechecks bytes and target admission after the replacement file has been staged', async () => {
    const fixture = await teamLandingFixture(repo)
    let didSave = false
    const access = landingFileAccess(repo.root, repo.staging, {
      validateTarget: async () => {
        const names = await readdir(repo.root)
        if (didSave || names.every((name) => !name.startsWith('a.txt.'))) {
          return
        }

        didSave = true
        await repo.write('a.txt', 'editor save at final check\n')
      },
    })
    const landing = new TeamLanding({
      ...fixture.deps,
      replace: (_root, file, canWrite) =>
        access.replace(file.path, file.before, file.after, canWrite),
    })
    expect(await landing.land(repo.root, fixture.admission)).toMatchObject({
      status: 'changed',
      paths: ['a.txt'],
    })
    expect(didSave).toBe(true)
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe(
      'editor save at final check\n',
    )
  })

  it.each(['checkout-index', 'clean', 'HEAD', 'linked-worktree'])(
    'reports the visible change from a lock-ignoring writer: %s',
    async (writer) => {
      await repo.write('dependency.txt', 'dependency\n')
      const fixture = await teamLandingFixture(repo)
      const landing = new TeamLanding({
        ...fixture.deps,
        replace: async (_root, file, canWrite) => {
          const isReplaced = await fixture.access.replace(
            file.path,
            file.before,
            file.after,
            canWrite,
          )
          switch (writer) {
            case 'checkout-index': {
              await repo.git(['checkout-index', '-f', '--', 'a.txt'])
              break
            }
            case 'clean': {
              await repo.git(['clean', '-f', '--', 'dependency.txt'])
              break
            }
            case 'HEAD': {
              await repo.git(['update-ref', 'HEAD', fixture.admission.snapshot.commit])
              break
            }
            case 'linked-worktree': {
              const linked = path.join(repo.storage, 'linked')
              await repo.git(['worktree', 'add', '--force', linked, 'main'])
              await repo.write('linked.txt', 'new ref\n', linked)
              await repo.git(['add', '.'], linked)
              await repo.git(['commit', '-m', 'linked writer'], linked)

              break
            }
            // No default
          }
          return isReplaced
        },
      })
      const result = await landing.land(repo.root, fixture.admission)
      let changedPath = 'HEAD'
      if (writer === 'checkout-index') changedPath = 'a.txt'
      else if (writer === 'clean') changedPath = 'dependency.txt'
      expect(result).toMatchObject({
        status: 'changed',
        paths: expect.arrayContaining([changedPath]),
      })
    },
  )

  it('keeps a partial landing journal and lock, then Recover restores only matching bytes', async () => {
    const fixture = await teamLandingFixture(repo, {
      'a.txt': 'landed-a\n',
      'b.txt': 'landed-b\n',
      'c.txt': 'new-c\n',
      'd.txt': 'new-d\n',
    })
    let count = 0
    const landing = new TeamLanding({
      ...fixture.deps,
      replace: async (_root, file, canWrite) => {
        if (count === 2) throw new Error('interrupted')
        count += 1
        return await fixture.access.replace(file.path, file.before, file.after, canWrite)
      },
    })
    await expect(landing.land(repo.root, fixture.admission)).rejects.toThrow('interrupted')
    const intent = await fixture.journal.read('landing-one')
    expect(intent.status).toBe('open')
    expect(await fixture.landing.recover(intent)).toMatchObject({ status: 'busy' })
    expect(await fixture.journal.read('landing-one')).toMatchObject({ status: 'open' })
    // Simulate the user's terminal removal, after stopping the old lander.
    await unlink(path.join(fixture.gitDirectory, 'index.lock'))
    const next = await teamLandingFixture(repo, { 'a.txt': 'new landing\n' }, 'next')
    expect(await next.landing.land(repo.root, next.admission)).toMatchObject({ status: 'busy' })
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('landed-a\n')
    await repo.write('b.txt', 'user changed b\n')
    expect(await fixture.landing.recover(intent)).toMatchObject({
      status: 'changed',
      paths: ['b.txt'],
    })
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
    expect(await readFile(path.join(repo.root, 'b.txt'), 'utf8')).toBe('user changed b\n')
    await expect(readFile(path.join(repo.root, 'c.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fixture.journal.read('landing-one')).toMatchObject({ status: 'recovered' })
  })

  it('requires owner authorization for recovery and Undo batch for shared files', async () => {
    const fixture = await teamLandingFixture(repo)
    const result = await fixture.landing.land(repo.root, {
      ...fixture.admission,
      owners: new Map([['a.txt', ['task-one', 'task-two']]]),
    })
    if (result.status !== 'landed') throw new Error('expected landing')
    const recovery = new TeamLanding({
      ...fixture.deps,
      authorizeRecovery: () => Promise.resolve(false),
    })
    expect(await recovery.recover(result.intent)).toMatchObject({ status: 'denied' })
    expect(await fixture.landing.undo(result.intent, 'task-one')).toMatchObject({
      status: 'changed',
      paths: ['a.txt'],
    })
    expect(await fixture.landing.undo(result.intent, null)).toMatchObject({
      status: 'landed',
      paths: [],
    })
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
  })

  it('rejects journal path escapes and revalidates targets after staging', async () => {
    const fixture = await teamLandingFixture(repo)
    const store = { read: vi.fn(), write: vi.fn() }
    const journal = new LandingJournal(store)
    await expect(journal.read('../outside')).rejects.toThrow()
    expect(store.read).not.toHaveBeenCalled()
    store.read.mockResolvedValue({ status: 'unknown' })
    await expect(journal.read('valid')).rejects.toThrow()
    const access = landingFileAccess(repo.root, repo.staging, {
      validateTarget: fixture.validateTarget,
    })
    for (const name of [
      '../outside',
      './a.txt',
      '.GIT/config',
      'C:/outside',
      '/absolute',
      String.raw`a\b`,
    ])
      await expect(access.read(name)).rejects.toThrow()
    await expect(
      fixture.journal.prepare({
        id: 'bad',
        windowInstanceId: 'window-one',
        root: repo.root,
        head: 'head',
        snapshotTree: 'tree',
        checkIdentity: 'check',
        status: 'open',
        conflicts: [],
        files: [{ path: '../outside', before: null, after: null, tasks: ['task'] }],
      }),
    ).rejects.toThrow()
    expect(await fixture.landing.land(repo.root, fixture.admission)).toMatchObject({
      status: 'landed',
    })
    const record = await fixture.journal.read('landing-one')
    await expect(fixture.journal.prepare(record)).rejects.toThrow('open')
    await expect(
      fixture.journal.prepare({
        ...record,
        status: 'open',
        files: [...record.files, ...record.files],
      }),
    ).rejects.toThrow()
    await repo.outsideLink('redirect')
    await expect(access.read('redirect/a.txt')).rejects.toThrow()
    await access.read('a.txt')
    expect(fixture.validateTarget).toHaveBeenCalled()
  })

  it('treats only another window fresh on this same working tree as a known holder', async () => {
    const fixture = await teamLandingFixture(repo)
    const hint = { workingTree: repo.root, windowInstanceId: 'other', fresh: true }
    expect(
      await knownRepositoryHolder(repo.root, fixture.gitDirectory, 'window-one', [hint]),
    ).toEqual({ kind: 'hint', windowInstanceId: 'other' })
    expect(
      await knownRepositoryHolder(repo.root, fixture.gitDirectory, 'window-one', [
        { ...hint, fresh: false },
      ]),
    ).toBeUndefined()
    expect(
      await knownRepositoryHolder(repo.root, fixture.gitDirectory, 'window-one', [
        { ...hint, workingTree: fixture.copy },
      ]),
    ).toBeUndefined()
  })
})
