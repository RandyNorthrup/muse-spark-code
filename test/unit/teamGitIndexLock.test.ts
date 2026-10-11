import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  indexLockHolder,
  knownRepositoryHolder,
  takeIndexLock,
} from '../../src/host/team/gitIndexLock'
import { teamRepository } from './helpers/teamRepository'
import { teamLandingFixture } from './helpers/teamLanding'

// These real child-process barriers include Git clones, a bundle and killed-process recovery.
const REAL_LANDER_TIMEOUT_MS = 60_000

const CHILD = String.raw`
const fs = require('node:fs/promises');
const { once } = require('node:events');
const api = require(process.argv[1]);
async function main() {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const staging = new api.StagingCopy(api.processGitProcess(), process.env, config.temporaryRoot);
  const journal = new api.LandingJournal({
    read: async () => JSON.parse(await fs.readFile(config.journalFile, 'utf8')),
    write: async (record) => {
      await api.writeFileAtomically(config.journalFile, JSON.stringify(record), { sleep: () => Promise.resolve() });
      const handle = await fs.open(config.journalFile, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
    }
  });
  const taken = await api.takeIndexLock(config.gitDirectory, { landingId: config.intent.id, windowInstanceId: 'window-one' });
  if (taken.kind !== 'taken') throw new Error('busy');
  await journal.prepare(config.intent);
  const access = api.landingFileAccess(config.intent.root, staging, { validateTarget: () => Promise.resolve() });
  for (const file of config.intent.files.slice(0, config.pauseAfter)) {
    if (!await access.replace(file.path, file.before, file.after, taken.lease.isHeld)) throw new Error('changed');
  }
  process.stdout.write('paused\n');
  await once(process.stdin, 'data');
  for (const file of config.intent.files.slice(config.pauseAfter)) await access.replace(file.path, file.before, file.after, taken.lease.isHeld);
  await journal.close(config.intent, 'landed', []);
  await taken.lease.release();
}
main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`

describe('git index ownership and killed landers', () => {
  let repo: Awaited<ReturnType<typeof teamRepository>>
  beforeEach(async () => {
    repo = await teamRepository()
  })
  afterEach(async () => {
    await repo.dispose()
  })

  it('gives each acquisition distinct owner bytes even for the same landing and window', async () => {
    const directory = await repo.staging.gitDirectory(repo.root)
    const owner = { landingId: 'same', windowInstanceId: 'same-window' }
    const first = await takeIndexLock(directory, owner)
    if (first.kind !== 'taken') throw new Error('expected lock')
    const bytes = await readFile(first.lease.path, 'utf8')
    expect(await first.lease.release()).toBe(true)
    const second = await takeIndexLock(directory, owner)
    if (second.kind !== 'taken') throw new Error('expected lock')
    try {
      expect(await readFile(second.lease.path, 'utf8')).not.toBe(bytes)
      expect(await second.lease.isHeld()).toBe(true)
    } finally {
      await second.lease.release()
    }
  })

  it('ignores only the exact owned lock while still observing operations and fresh hints', async () => {
    const directory = await repo.staging.gitDirectory(repo.root)
    const owner = { landingId: 'one', windowInstanceId: 'window-one' }
    const taken = await takeIndexLock(directory, owner)
    if (taken.kind !== 'taken') throw new Error('expected lock')
    const holder = (hints: Parameters<typeof knownRepositoryHolder>[3] = []) =>
      knownRepositoryHolder(
        repo.root,
        directory,
        'window-one',
        hints,
        process.platform,
        taken.lease,
      )
    expect(await holder()).toBeUndefined()
    expect(
      await holder([{ workingTree: repo.root, windowInstanceId: 'other', fresh: true }]),
    ).toMatchObject({ kind: 'hint' })
    await repo.write('.git/rebase-merge/marker', 'operation')
    expect(await holder()).toMatchObject({ kind: 'operation' })
    await unlink(taken.lease.path)
    expect(await holder()).toMatchObject({ kind: 'lock' })
    await writeFile(taken.lease.path, JSON.stringify(owner))
    expect(await holder()).toMatchObject({ kind: 'lock' })
    expect(await taken.lease.release()).toBe(false)
    expect(await readFile(taken.lease.path, 'utf8')).toContain('window-one')
  })

  it('waits the full bound on a foreign lock, never removes it, and retries only after user removal', async () => {
    const gitDirectory = await repo.staging.gitDirectory(repo.root)
    const file = path.join(gitDirectory, 'index.lock')
    await writeFile(file, 'foreign lock')
    let now = 0
    const clock = {
      now: () => now,
      sleep: (ms: number) => {
        now += ms
        return Promise.resolve()
      },
      waitMs: 30_000,
    }
    const result = await takeIndexLock(
      gitDirectory,
      { landingId: 'one', windowInstanceId: 'window-one' },
      clock,
    )
    expect(result.kind).toBe('busy')
    expect(now).toBe(30_000)
    expect(await readFile(file, 'utf8')).toBe('foreign lock')
    await unlink(file)
    const retry = await takeIndexLock(gitDirectory, {
      landingId: 'one',
      windowInstanceId: 'window-one',
    })
    if (retry.kind !== 'taken') throw new Error('expected lock')
    expect(await indexLockHolder(gitDirectory)).toMatchObject({
      owner: { landingId: 'one', windowInstanceId: 'window-one' },
    })
    expect(await retry.lease.release()).toBe(true)
    expect(await retry.lease.release()).toBe(false)
  })

  it('does not release a replaced lock, even when the original owner is done', async () => {
    const gitDirectory = await repo.staging.gitDirectory(repo.root)
    const taken = await takeIndexLock(gitDirectory, {
      landingId: 'one',
      windowInstanceId: 'window-one',
    })
    if (taken.kind !== 'taken') throw new Error('expected lock')
    await unlink(taken.lease.path)
    await writeFile(taken.lease.path, 'new owner')
    expect(await taken.lease.release()).toBe(false)
    expect(await readFile(taken.lease.path, 'utf8')).toBe('new owner')
  })

  it('does not release a lock whose contents changed in place', async () => {
    const directory = await repo.staging.gitDirectory(repo.root)
    const taken = await takeIndexLock(directory, {
      landingId: 'one',
      windowInstanceId: 'window-one',
    })
    if (taken.kind !== 'taken') throw new Error('expected lock')
    await writeFile(taken.lease.path, 'changed owner in same file')
    expect(await taken.lease.release()).toBe(false)
    expect(await readFile(taken.lease.path, 'utf8')).toBe('changed owner in same file')
  })

  it('does not follow a foreign symlink lock when reading its owner', async () => {
    const gitDirectory = await repo.staging.gitDirectory(repo.root)
    const outside = path.join(repo.folder, 'canary')
    await writeFile(outside, JSON.stringify({ landingId: 'canary', windowInstanceId: 'other' }))
    await symlink(outside, path.join(gitDirectory, 'index.lock'))
    expect(await indexLockHolder(gitDirectory)).toMatchObject({ owner: null })
    expect(await readFile(outside, 'utf8')).toContain('canary')
  })

  it('uses the linked worktree own index lock and recognizes every recorded git operation', async () => {
    const linked = path.join(repo.storage, 'linked')
    await repo.git(['worktree', 'add', '-b', 'linked', linked])
    const directory = await repo.staging.gitDirectory(linked)
    expect(directory).not.toBe(path.join(repo.root, '.git'))
    const taken = await takeIndexLock(directory, {
      landingId: 'one',
      windowInstanceId: 'window-one',
    })
    if (taken.kind !== 'taken') throw new Error('expected lock')
    await expect(repo.git(['add', 'a.txt'], linked)).rejects.toThrow('index.lock')
    await expect(repo.git(['add', 'a.txt'])).resolves.toBe('')
    await taken.lease.release()
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']) {
      await writeFile(path.join(directory, name), 'operation')
      expect(await knownRepositoryHolder(linked, directory, 'window-one', [])).toMatchObject({
        kind: 'operation',
        path: path.join(directory, name),
      })
      await unlink(path.join(directory, name))
    }
    for (const name of ['rebase-merge', 'rebase-apply', 'sequencer']) {
      await mkdir(path.join(directory, name))
      expect(await knownRepositoryHolder(linked, directory, 'window-one', [])).toMatchObject({
        kind: 'operation',
      })
      await repo.git(['rev-parse', '--verify', 'HEAD'], linked)
    }
  })

  it.each([0, 2, 'resume'] as const)(
    'preserves real lander ownership at the barrier: %s',
    async (pauseAfter) => {
      const fixture = await teamLandingFixture(repo, {
        'a.txt': 'landed-a\n',
        'b.txt': 'landed-b\n',
        'c.txt': 'new-c\n',
        'd.txt': 'new-d\n',
      })
      const bundle = path.join(repo.storage, 'child.cjs')
      const imports = [
        "export { takeIndexLock } from './src/host/team/gitIndexLock'",
        "export { LandingJournal, landingFileAccess } from './src/host/team/landingJournal'",
        "export { StagingCopy } from './src/host/team/stagingCopy'",
        "export { processGitProcess } from './src/host/git'",
        "export { writeFileAtomically } from './src/host/fsAtomic'",
      ]
      await build({
        stdin: { contents: imports.join('\n'), resolveDir: process.cwd(), loader: 'ts' },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundle,
        logLevel: 'silent',
      })
      const { admission } = fixture
      const intent = {
        id: admission.id,
        windowInstanceId: 'window-one',
        root: repo.root,
        head: admission.snapshot.head,
        snapshotTree: admission.snapshot.tree,
        checkIdentity: admission.checkIdentity,
        status: 'open',
        conflicts: [],
        files: Array.from(admission.owners, ([file, tasks]) => ({
          path: file,
          before: admission.snapshot.blobs.get(file) ?? null,
          after: admission.final.blobs.get(file) ?? null,
          tasks,
        })),
      }
      const config = path.join(repo.storage, 'child.json')
      await writeFile(
        config,
        JSON.stringify({
          intent,
          gitDirectory: fixture.gitDirectory,
          journalFile: fixture.journalFile,
          temporaryRoot: path.join(repo.storage, 'child-index'),
          pauseAfter: pauseAfter === 'resume' ? 0 : pauseAfter,
        }),
      )
      const child = spawn(process.execPath, ['-e', CHILD, bundle, config], {
        env: repo.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const ended = once(child, 'close')
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('child failed to reach barrier'))
          }, 10_000)
          child.stdout.once('data', () => {
            clearTimeout(timer)
            resolve()
          })
          child.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
          child.once('exit', (code) => {
            clearTimeout(timer)
            reject(new Error(`child exited: ${String(code)}`))
          })
        })
        const record = await fixture.journal.read('landing-one')
        expect(record.status).toBe('open')
        const blocked = await takeIndexLock(
          fixture.gitDirectory,
          { landingId: 'two', windowInstanceId: 'window-two' },
          { now: () => 0, sleep: () => Promise.resolve(), waitMs: 0 },
        )
        expect(blocked.kind).toBe('busy')
        if (pauseAfter === 'resume') {
          child.stdin.end('resume\n')
          await ended
          expect(await indexLockHolder(fixture.gitDirectory)).toBeUndefined()
          const retry = await takeIndexLock(fixture.gitDirectory, {
            landingId: 'two',
            windowInstanceId: 'window-two',
          })
          if (retry.kind !== 'taken') throw new Error('expected retry lock')
          expect(await retry.lease.release()).toBe(true)
          expect(await fixture.landing.land(repo.root, fixture.admission)).toMatchObject({
            status: 'stale',
          })
          expect(fixture.deps.invalidate).toHaveBeenCalledOnce()
          expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('landed-a\n')
          return
        }
        child.kill('SIGKILL')
        await ended
        expect(await indexLockHolder(fixture.gitDirectory)).toMatchObject({ kind: 'lock' })
        expect(await fixture.landing.recover(record)).toMatchObject({ status: 'busy' })
        // The next window never deletes the stale lock; this is the user's terminal action.
        await unlink(path.join(fixture.gitDirectory, 'index.lock'))
        if (pauseAfter === 2) await repo.write('b.txt', 'user edited b\n')
        expect(await fixture.landing.recover(record)).toMatchObject({
          status: pauseAfter === 2 ? 'changed' : 'landed',
          paths: pauseAfter === 2 ? ['b.txt'] : [],
        })
        expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
        expect(await readFile(path.join(repo.root, 'b.txt'), 'utf8')).toBe(
          pauseAfter === 2 ? 'user edited b\n' : 'base-b\n',
        )
        await expect(readFile(path.join(repo.root, 'c.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        child.kill('SIGKILL')
        await ended
      }
    },
    REAL_LANDER_TIMEOUT_MS,
  )
})
