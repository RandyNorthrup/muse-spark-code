// M71's held checkout (src/host/git/heldCheckout.ts) over a fake git and the
// real file system: what runs where, what is written, and what refuses. The
// real git runs in pullRequestCheckoutGit.test.ts; the streaming process
// this uses runs real `git cat-file --batch` at the end.

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import {
  type GitProcess,
  processGitProcess,
  processGitRunner,
  UNTRUSTED_CHECKOUT_OPTIONS,
} from '../../src/host/git'
import { createHeldCheckout } from '../../src/host/git/heldCheckout'
import {
  HELD_CHECKOUT_MAX_BYTES,
  HELD_CHECKOUT_MAX_ENTRIES,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, formatBytes } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const COMMIT = 'c'.repeat(40)
const SUBMODULE_COMMIT = '1'.repeat(40)
// Answers cross chunk boundaries everywhere at this size.
const CHUNK_BYTES = 7
const LISTING_OUTPUT_CAP = 64
const execFileAsync = promisify(execFile)
const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-m71-held-')))
const counter = { cases: 0 }

afterAll(async () => {
  await removeFolder(base)
})

interface Entry {
  readonly mode: '100644' | '100755' | '120000' | '160000'
  readonly path: string
  readonly bytes?: Buffer
}

function listingOf(entries: readonly Entry[]): string {
  return entries
    .map((entry) =>
      entry.mode === '160000'
        ? `${entry.mode} commit ${SUBMODULE_COMMIT}       -\t${entry.path}\0`
        : `${entry.mode} blob ${gitBlobOid(entry.bytes ?? Buffer.alloc(0))} ${String(entry.bytes?.length ?? 0).padStart(7)}\t${entry.path}\0`,
    )
    .join('')
}

/** What `git cat-file --batch` answers for these object names. */
function answersFor(input: string, entries: readonly Entry[]): Buffer {
  const blobs = new Map(
    entries.map((entry) => [gitBlobOid(entry.bytes ?? Buffer.alloc(0)), entry.bytes]),
  )
  return Buffer.concat(
    input
      .split('\n')
      .filter((oid) => oid !== '')
      .map((oid) => {
        const bytes = blobs.get(oid)
        return bytes === undefined
          ? Buffer.from(`${oid} missing\n`)
          : Buffer.concat([
              Buffer.from(`${oid} blob ${String(bytes.length)}\n`),
              bytes,
              Buffer.from('\n'),
            ])
      }),
  )
}

interface FakeOptions {
  readonly commit?: string
  readonly listing?: () => Promise<string>
  /** Replaces what cat-file answers. */
  readonly answer?: (normal: Buffer) => Buffer
  /** Runs once the worktree is added (a link planted, a file already there). */
  readonly afterAdd?: (folder: string) => Promise<void>
  /** Runs when git is asked to remove the worktree, before it does. */
  readonly beforeRemove?: (folder: string) => Promise<void>
  readonly check?: (folder: string) => void
}

/** A held checkout of `entries` over a fake git, into a folder of its own. */
async function heldCheckout(entries: readonly Entry[], options: FakeOptions = {}) {
  counter.cases += 1
  const repository = path.join(base, `repository-${String(counter.cases)}`)
  const folder = path.join(base, `held-${String(counter.cases)}`)
  await mkdir(repository)
  const calls: { readonly args: readonly string[]; readonly cwd: string }[] = []
  const log = new FakeLogOutputChannel()
  const gitProcess: GitProcess = async (args, processOptions) => {
    calls.push({ args, cwd: processOptions.cwd })
    const normal = answersFor(String(processOptions.input), entries)
    const answer = options.answer?.(normal) ?? normal
    for (let offset = 0; offset < answer.length; offset += CHUNK_BYTES) {
      await processOptions.onStdout?.(answer.subarray(offset, offset + CHUNK_BYTES))
    }
    return Buffer.alloc(0)
  }
  const checkOut = createHeldCheckout({
    platform: process.platform,
    runGit: async (args, cwd, _timeoutMs, beforeRun) => {
      beforeRun?.()
      calls.push({ args, cwd })
      if (args[0] === 'ls-tree') {
        return await (options.listing?.() ?? listingOf(entries))
      }
      if (args[1] === 'add') {
        await mkdir(folder)
        await writeFile(path.join(folder, '.git'), 'gitdir: elsewhere\n')
        await options.afterAdd?.(folder)
      } else if (args[1] === 'remove') {
        await options.beforeRemove?.(folder)
        await rm(folder, { recursive: true, force: true })
      }
      return ''
    },
    gitProcess,
    env: { PATH: '/usr/bin' },
    log,
  })
  const run = checkOut(folder, options.commit ?? COMMIT, repository, () => options.check?.(folder))
  return { run, calls, folder, repository, log }
}

const FILES: readonly Entry[] = [
  // Bytes as stored: a CR stays, no conversion runs.
  { mode: '100644', path: 'a.txt', bytes: Buffer.from('one\r\ntwo\n') },
  { mode: '100755', path: 'bin/run.sh', bytes: Buffer.from('#!/bin/sh\necho ran\n') },
  { mode: '120000', path: 'link', bytes: Buffer.from('a.txt') },
  { mode: '160000', path: 'vendor/sub' },
  { mode: '100644', path: 'empty', bytes: Buffer.alloc(0) },
  {
    mode: '100644',
    path: 'nested/deep/large.bin',
    bytes: Buffer.from(Array.from({ length: 70_000 }, (_, index) => (index * 31) % 256)),
  },
]

describe('the held checkout (M71)', () => {
  it.each(['--help', '', 'c'.repeat(39), 'g'.repeat(40)])(
    'refuses a non-commit SHA %j before any git runs',
    async (commit) => {
      const t = await heldCheckout(FILES, { commit })
      await expect(t.run).rejects.toThrow(UI_TEXT.openPullRequestFetchFailed)
      expect(t.calls).toEqual([])
      expect(existsSync(t.folder)).toBe(false)
    },
  )

  it('refuses an overflowing ls-tree listing as too large before adding a worktree', async () => {
    const t = await heldCheckout(FILES, {
      // Real execFile maxBuffer failure, with a small injected cap instead of 64 MB.
      listing: async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [
            '-e',
            'process.stdout.write(Buffer.from(process.argv[1], "base64"))',
            Buffer.from(listingOf(FILES)).toString('base64'),
          ],
          { encoding: 'utf8', maxBuffer: LISTING_OUTPUT_CAP },
        )
        return stdout
      },
    })
    await expect(t.run).rejects.toThrow(
      fill(UI_TEXT.openPullRequestTooLarge, {
        files: HELD_CHECKOUT_MAX_ENTRIES,
        size: formatBytes(HELD_CHECKOUT_MAX_BYTES),
      }),
    )
    expect(t.calls.map((call) => call.args[0])).toEqual(['ls-tree'])
    expect(existsSync(t.folder)).toBe(false)
  })

  it('keeps an ordinary ls-tree failure unchanged', async () => {
    const error = new Error('fatal: listing failed')
    const t = await heldCheckout(FILES, { listing: () => Promise.reject(error) })
    await expect(t.run).rejects.toBe(error)
    expect(existsSync(t.folder)).toBe(false)
  })

  it('writes the commit as stored, running git in the worktree only before its first byte', async () => {
    const t = await heldCheckout(FILES)
    await t.run
    for (const entry of FILES) {
      if (entry.bytes !== undefined) {
        expect(await readFile(path.join(t.folder, entry.path))).toEqual(entry.bytes)
      }
    }
    // A link is a file holding its target; a submodule an empty folder.
    expect(lstatSync(path.join(t.folder, 'link')).isFile()).toBe(true)
    expect(statSync(path.join(t.folder, 'vendor', 'sub')).isDirectory()).toBe(true)
    expect(readdirSync(path.join(t.folder, 'vendor', 'sub'))).toEqual([])
    if (process.platform !== 'win32') {
      expect(statSync(path.join(t.folder, 'bin', 'run.sh')).mode & 0o111).not.toBe(0)
      expect(statSync(path.join(t.folder, 'a.txt')).mode & 0o111).toBe(0)
    }
    expect(t.calls).toEqual([
      { args: ['ls-tree', '-r', '-z', '--full-tree', '--long', COMMIT], cwd: t.repository },
      {
        args: ['worktree', 'add', '--no-checkout', '--detach', t.folder, COMMIT],
        cwd: t.repository,
      },
      { args: ['read-tree', COMMIT], cwd: t.folder },
      { args: [...UNTRUSTED_CHECKOUT_OPTIONS, 'cat-file', '--batch'], cwd: t.repository },
    ])
  })

  it('refuses a listing it does not write before any worktree is added', async () => {
    const t = await heldCheckout([
      { mode: '100644', path: 'a.txt', bytes: Buffer.from('a') },
      { mode: '100644', path: '.git/hooks/post-checkout', bytes: Buffer.from('#!/bin/sh') },
    ])
    await expect(t.run).rejects.toThrow(
      fill(UI_TEXT.openPullRequestUnsafePath, { path: '".git/hooks/post-checkout"' }),
    )
    expect(t.calls.map((call) => call.args[0])).toEqual(['ls-tree'])
    expect(existsSync(t.folder)).toBe(false)
  })

  it.each([
    [
      'a missing object',
      (normal: Buffer) =>
        // Keep the second answer intact, so missing-object and truncation guards are distinct.
        Buffer.from(
          normal.toString('latin1').replace(' blob 9\none\r\ntwo\n\n', ' missing\n'),
          'latin1',
        ),
    ],
    [
      'another size',
      (normal: Buffer) =>
        Buffer.from(normal.toString('latin1').replace(' blob 9\n', ' blob 8\n'), 'latin1'),
    ],
    ['a byte past the last answer', (normal: Buffer) => Buffer.concat([normal, Buffer.from('x')])],
    ['an answer cut short', (normal: Buffer) => normal.subarray(0, -1)],
  ])('refuses %s and removes the worktree', async (_label, answer) => {
    const t = await heldCheckout(
      [
        { mode: '100644', path: 'a.txt', bytes: Buffer.from('one\r\ntwo\n') },
        { mode: '100644', path: 'b.txt', bytes: Buffer.from('second') },
      ],
      { answer },
    )
    await expect(t.run).rejects.toThrow(UI_TEXT.openPullRequestUnreadable)
    expect(t.calls.at(-1)).toEqual({
      args: ['worktree', 'remove', '--force', t.folder],
      cwd: t.repository,
    })
    expect(existsSync(t.folder)).toBe(false)
  })

  it('stops writing when trust ends part way, and runs no more git', async () => {
    const t = await heldCheckout(
      [
        { mode: '100644', path: 'a.txt', bytes: Buffer.from('first') },
        { mode: '100644', path: 'b.txt', bytes: Buffer.from('second') },
      ],
      {
        check: (folder) => {
          if (existsSync(path.join(folder, 'a.txt'))) {
            throw new Error('trust ended')
          }
        },
      },
    )
    await expect(t.run).rejects.toThrow('trust ended')
    expect(existsSync(path.join(t.folder, 'b.txt'))).toBe(false)
    expect(t.calls.at(-1)?.args).toContain('cat-file')
    // Its removal is git too: with trust gone it is left, and the log says so.
    expect(String(t.log.warn.mock.calls.at(-1)?.[0])).toContain('worktree was left')
  })

  it.each(['outside the worktree', 'inside the worktree'] as const)(
    'refuses a link or junction on the way, leading %s, and writes nothing where it leads',
    async (where) => {
      const outside = path.join(base, `outside-${String(counter.cases + 1)}`)
      let target = outside
      const t = await heldCheckout(
        [
          { mode: '100644', path: 'a.txt', bytes: Buffer.from('a') },
          { mode: '100644', path: 'dir/x.txt', bytes: Buffer.from('x') },
        ],
        {
          afterAdd: async (folder) => {
            // Inside, the path would still land in the worktree, but as another one.
            target = where === 'outside the worktree' ? outside : path.join(folder, 'other')
            await mkdir(target)
            await symlink(
              target,
              path.join(folder, 'dir'),
              process.platform === 'win32' ? 'junction' : 'dir',
            )
          },
          beforeRemove: () => {
            expect(readdirSync(target)).toEqual([])
            return Promise.resolve()
          },
        },
      )
      await expect(t.run).rejects.toThrow(
        fill(UI_TEXT.openPullRequestUnsafePath, { path: '"dir/x.txt"' }),
      )
      expect(t.calls.at(-1)?.args.slice(0, 2)).toEqual(['worktree', 'remove'])
    },
  )

  it('never writes over a file already there', async () => {
    let kept = ''
    const t = await heldCheckout(
      [{ mode: '100644', path: 'a.txt', bytes: Buffer.from('pull request') }],
      {
        afterAdd: async (folder) => {
          await writeFile(path.join(folder, 'a.txt'), 'already there')
        },
        beforeRemove: async (folder) => {
          kept = await readFile(path.join(folder, 'a.txt'), 'utf8')
        },
      },
    )
    await expect(t.run).rejects.toThrow()
    // The checkout failed rather than replace it; the worktree was then removed whole.
    expect(kept).toBe('already there')
    expect(existsSync(t.folder)).toBe(false)
  })
})

describe('createGitProcess handing stdout to a taker (M71)', () => {
  const git = processGitProcess()
  const run = processGitRunner()

  it('hands real cat-file answers to a slow taker one at a time, all of them, and stops at its refusal', async () => {
    const repository = path.join(base, 'real')
    await mkdir(repository)
    await run(['init', '-q'], repository)
    const large = Buffer.alloc(1_000_000, 'x')
    const written = await git(['hash-object', '-w', '--stdin'], {
      cwd: repository,
      env: process.env,
      input: large,
      timeoutMs: 30_000,
    })
    const oid = written.toString('utf8').trim()
    const taken: Buffer[] = []
    let taking = 0
    let mostAtOnce = 0
    const all = await git(['cat-file', '--batch'], {
      cwd: repository,
      env: process.env,
      input: `${oid}\n`,
      timeoutMs: 30_000,
      // As slow as a file write: git has closed long before the last chunk is taken.
      onStdout: async (chunk) => {
        taking += 1
        mostAtOnce = Math.max(mostAtOnce, taking)
        await new Promise((resolve) => {
          setTimeout(resolve, 2)
        })
        taken.push(chunk)
        taking -= 1
      },
    })
    expect(all).toEqual(Buffer.alloc(0))
    expect(Buffer.concat(taken)).toEqual(
      Buffer.concat([
        Buffer.from(`${oid} blob ${String(large.length)}\n`),
        large,
        Buffer.from('\n'),
      ]),
    )
    expect(taken.length).toBeGreaterThan(1)
    expect(mostAtOnce).toBe(1)
    let chunks = 0
    const refused = git(['cat-file', '--batch'], {
      cwd: repository,
      env: process.env,
      input: `${oid}\n`,
      timeoutMs: 30_000,
      onStdout: () => {
        chunks += 1
        return Promise.reject(new Error('the taker refused'))
      },
    })
    await expect(refused).rejects.toThrow('the taker refused')
    expect(chunks).toBe(1)
  })
})
