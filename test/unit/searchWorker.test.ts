// The worker-backed search (M7): the real worker file, bundled with esbuild
// into a temp folder for the test, run through `searchOnWorker` against
// real files, including the pathological pattern that must be stopped.

import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { searchOnWorker } from '../../src/host/backend/toolIo'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', worker: '' }

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-search-'))
  paths.worker = path.join(paths.root, 'searchWorker.js')
  const { root, worker: workerPath } = paths
  buildSync({
    entryPoints: [path.resolve('src/host/backend/searchWorker.ts')],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  await writeFile(path.join(root, 'a.txt'), 'alpha one\nbeta two\nalpha three\n')
  await writeFile(path.join(root, 'b.bin'), 'alpha\0binary')
})

afterAll(() => removeFolder(paths.root))

function job(pattern: string, names: readonly string[] = ['a.txt', 'b.bin', 'missing.txt']) {
  return {
    pattern,
    root: paths.root,
    files: names.map((name) => ({ relative: name, absolute: path.join(paths.root, name) })),
  }
}

describe('searchOnWorker', () => {
  it('reports the matching lines with their numbers, skipping binary and missing files', async () => {
    const outcome = await searchOnWorker(paths.worker, job('^alpha'), 10_000)
    expect(outcome).toEqual({
      ok: true,
      hits: [
        { file: 'a.txt', line: 1, text: 'alpha one' },
        { file: 'a.txt', line: 3, text: 'alpha three' },
      ],
    })
  }, 30_000)

  it('skips a file reached through a link that leaves the workspace (D24)', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'muse-search-outside-'))
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'alpha secret\n')
      // A junction needs no privilege on Windows; elsewhere it is a symlink.
      await symlink(outside, path.join(paths.root, 'elsewhere'), 'junction')
      const outcome = await searchOnWorker(
        paths.worker,
        job('^alpha', ['a.txt', 'elsewhere/secret.txt']),
        10_000,
      )
      expect(outcome).toEqual({
        ok: true,
        hits: [
          { file: 'a.txt', line: 1, text: 'alpha one' },
          { file: 'a.txt', line: 3, text: 'alpha three' },
        ],
      })
    } finally {
      await rm(path.join(paths.root, 'elsewhere'), { force: true })
      await removeFolder(outside)
    }
  }, 30_000)

  it('reports an invalid pattern', async () => {
    const outcome = await searchOnWorker(paths.worker, job('('), 10_000)
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('invalid pattern') })
  }, 30_000)

  it('stops a catastrophic pattern at the time budget, keeping what it found first (D27)', async () => {
    await writeFile(path.join(paths.root, 'long.txt'), `${'a'.repeat(40)}!\n`)
    await writeFile(path.join(paths.root, 'quick.txt'), 'aaa\n')
    const started = Date.now()
    const outcome = await searchOnWorker(
      paths.worker,
      job('^(a+)+$', ['quick.txt', 'long.txt']),
      500,
    )
    expect(outcome).toEqual({
      ok: true,
      hits: [{ file: 'quick.txt', line: 1, text: 'aaa' }],
      isPartial: true,
    })
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 30_000)

  it('reports a worker that cannot start', async () => {
    const outcome = await searchOnWorker(path.join(paths.root, 'nope.js'), job('x'), 10_000)
    expect(outcome).toMatchObject({ ok: false })
  }, 30_000)
})
