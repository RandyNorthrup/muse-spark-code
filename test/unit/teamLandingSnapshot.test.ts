// What a landing's snapshot costs, and what it reads (CC-WINLAND2). A landing takes four snapshots of
// the whole tree under git's lock, and hashing each file in a process of its own made one landing
// cost four processes a file: 8,089 for a tree of 2,000, and 71 s for a tree of 500 on Windows. Real
// git, real files, the product's own StagingCopy and engine ports.
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { TeamGit } from '../../src/core/team/teamGit'
import { blobId, StagingCopy } from '../../src/host/team/stagingCopy'
import { landingFixturesIn } from './helpers/teamLander'
import {
  fixtureGit,
  landingRunGit,
  landingTask,
  productLandingPorts,
} from './helpers/teamLandingFixture'

const scratches: string[] = []
afterAll(async () => {
  for (const folder of scratches.splice(0))
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

/** A repository with one committed file, and a staging copy over real git that counts its hashes. */
async function stagedRepo(beforeEachCall?: (args: readonly string[]) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-landing-snapshot-')))
  scratches.push(root)
  await fixtureGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'kept.txt'), 'kept\n')
  await fixtureGit(root, ['add', '-A'])
  await fixtureGit(root, ['commit', '-m', 'base'])
  const counted = { hashes: 0 }
  const staging = new StagingCopy(
    async (args, options) => {
      if (args.includes('hash-object')) counted.hashes += 1
      await beforeEachCall?.(args)
      const input =
        options.input === undefined ? undefined : Buffer.from(options.input).toString('utf8')
      return Buffer.from(await landingRunGit(args, options.cwd, input, options.env))
    },
    process.env,
    path.join(root, '.git', 'muse-snapshot-scratch'),
  )
  return { root, staging, counted }
}

/** What git itself calls a file's raw bytes. */
function rawBlob(root: string, file: string): string {
  return execFileSync('git', ['hash-object', '--no-filters', file], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
}

describe("a landing's snapshot of the tree", () => {
  it('hashes every file in one process, of its raw bytes', async () => {
    const { root, staging, counted } = await stagedRepo()
    // The repository's own wish to convert line endings must not touch what a snapshot reads.
    await writeFile(path.join(root, '.gitattributes'), '* text eol=lf\n')
    for (let at = 0; at < 40; at += 1)
      await writeFile(path.join(root, `extra-${String(at)}.txt`), `extra ${String(at)}\r\n`)
    await writeFile(path.join(root, 'odd name é.txt'), 'odd\n')
    const snapshot = await staging.snapshot(root)
    expect(counted.hashes).toBe(1)
    expect(snapshot.blobs.size).toBe(43)
    for (const file of ['kept.txt', 'extra-7.txt', 'odd name é.txt'])
      expect(snapshot.blobs.get(file)?.oid).toBe(rawBlob(root, file))
    const written = execFileSync('git', ['cat-file', 'blob', rawBlob(root, 'extra-7.txt')], {
      cwd: root,
    })
    expect(written.toString('utf8')).toBe('extra 7\r\n')
  })

  it('leaves out a file that goes away while it hashes, and keeps the rest', async () => {
    const gone = { isDone: false }
    const rig = await stagedRepo(async (args) => {
      if (gone.isDone || !args.includes('--stdin-paths')) return
      gone.isDone = true
      await rm(path.join(rig.root, 'gone.txt'))
    })
    await writeFile(path.join(rig.root, 'gone.txt'), 'gone\n')
    for (let at = 0; at < 20; at += 1)
      await writeFile(path.join(rig.root, `extra-${String(at)}.txt`), 'extra\n')
    const snapshot = await rig.staging.snapshot(rig.root)
    expect(gone.isDone).toBe(true)
    expect(snapshot.blobs.has('gone.txt')).toBe(false)
    expect(snapshot.blobs.has('kept.txt')).toBe(true)
    expect(snapshot.blobs.has('extra-19.txt')).toBe(true)
    // Once more for the list, not once for each file: a tree holds thousands.
    expect(rig.counted.hashes).toBe(2)
  })

  it('reads the tree under the lock as a snapshot does, and writes nothing to', async () => {
    const { root, staging } = await stagedRepo()
    await writeFile(path.join(root, 'extra.txt'), 'extra\r\n')
    await writeFile(path.join(root, 'kept.txt'), 'edited\n')
    const reading = await staging.reading(root)
    // Not stored: only the ids git would give them.
    for (const file of ['extra.txt', 'kept.txt']) {
      const oid = reading.blobs.get(file)?.oid ?? ''
      expect(oid).toBe(rawBlob(root, file))
      expect(() => {
        execFileSync('git', ['cat-file', '-e', oid], { cwd: root, stdio: 'ignore' })
      }).toThrow()
    }
    const snapshot = await staging.snapshot(root)
    expect(reading.blobs).toEqual(snapshot.blobs)
    expect(reading.head).toBe(snapshot.head)
  })

  it('names a blob as git does, in either kind of repository', async () => {
    for (const objectFormat of ['sha1', 'sha256']) {
      const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-landing-blob-')))
      scratches.push(root)
      await fixtureGit(root, ['init', '-b', 'main', `--object-format=${objectFormat}`])
      await writeFile(path.join(root, 'file.txt'), 'text\r\n\0binary é')
      await fixtureGit(root, ['add', '-A'])
      await fixtureGit(root, ['commit', '-m', 'base'])
      const headOut = await fixtureGit(root, ['rev-parse', 'HEAD'])
      const bytes = await readFile(path.join(root, 'file.txt'))
      expect(blobId(bytes, headOut.trim())).toBe(rawBlob(root, 'file.txt'))
      expect(blobId(new Uint8Array(), headOut.trim())).toBe(
        execFileSync('git', ['hash-object', '--stdin'], {
          cwd: root,
          input: '',
          encoding: 'utf8',
        }).trim(),
      )
    }
  })

  // Windows has no such file name, and a link there needs a privilege.
  it.skipIf(process.platform === 'win32')(
    'reads a name the list cannot carry, and a link as its target',
    async () => {
      const { root, staging, counted } = await stagedRepo()
      await writeFile(path.join(root, 'new\nline.txt'), 'newline\n')
      await writeFile(path.join(root, '"quoted".txt'), 'quoted\n')
      await symlink('kept.txt', path.join(root, 'link.txt'))
      for (let at = 0; at < 20; at += 1) {
        await writeFile(path.join(root, `extra-${String(at)}.txt`), 'extra\n')
        await symlink('kept.txt', path.join(root, `link-${String(at)}.txt`))
      }
      const snapshot = await staging.snapshot(root)
      // The links' list, the files' list, and the one name a list cannot carry.
      expect(counted.hashes).toBe(3)
      expect(snapshot.blobs.get('link-19.txt')?.oid).toBe(
        execFileSync('git', ['hash-object', '--stdin'], {
          cwd: root,
          input: 'kept.txt',
          encoding: 'utf8',
        }).trim(),
      )
      expect(snapshot.blobs.get('new\nline.txt')?.oid).toBe(rawBlob(root, 'new\nline.txt'))
      expect(snapshot.blobs.get('"quoted".txt')?.oid).toBe(rawBlob(root, '"quoted".txt'))
      expect(snapshot.blobs.get('link.txt')?.mode).toBe('120000')
      expect(await readFile(path.join(root, 'link.txt'), 'utf8')).toBe('kept\n')
    },
  )
})

describe('a landing over a larger tree', () => {
  const fixtureFor = landingFixturesIn('asCreated')

  /** One landing; returns the git processes it took, and those that hashed. */
  const landOver = async (taskId: string, extras: number) => {
    const fixture = await fixtureFor(taskId, ['a.txt', 'b.txt'])
    for (let at = 0; at < extras; at += 1)
      await writeFile(path.join(fixture.root, `extra-${String(at)}.txt`), `${String(at)}\n`)
    const counted = { calls: 0, hashes: 0 }
    const countingGit: TeamGit = async (args, cwd, input, env) => {
      counted.calls += 1
      if (args.includes('hash-object')) counted.hashes += 1
      return await landingRunGit(args, cwd, input, env)
    }
    const task = landingTask(fixture)
    const merged = await productLandingPorts(fixture, undefined, countingGit).merges.merge(
      { ...task, outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) } },
      new AbortController().signal,
      { allowProtected: false },
    )
    expect(merged).toMatchObject({ status: 'merged' })
    return counted
  }

  it('takes as many git processes as over a smaller one', async () => {
    const small = await landOver('task-small', 0)
    const large = await landOver('task-large', 40)
    expect(large).toEqual(small)
  }, 120_000)
})
