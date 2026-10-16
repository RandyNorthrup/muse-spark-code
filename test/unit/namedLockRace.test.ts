// POSIX stale-socket recovery by ownership (RVHOSTID R2): the real named lock,
// in real processes that meet at the same instant on folders holding dead
// socket files, the way a crashed holder leaves them. A second holder inside
// the protected work is what hurt a person: two writers destroying one
// credential. The driver (test/hosts/named-lock-race.mjs) is a plain node
// script, so the lead can also run it by hand on any machine.
//
// On Windows the same driver races the named pipe (no socket files exist
// there). The Unix-socket branch needs macOS or Linux and is marked for the
// lead's run (docs/certification/chatgpt-grant-lock.md, "PLANFIX R2").
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { withNamedLock } from '../../src/runtime/namedLock'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_SCOPE_CHARS,
  KEYSTORE_LOCK_ACCOUNT_CHARS,
  KEYSTORE_LOCK_DIR,
  NAMED_LOCK_ENTRY_BYTES,
} from '../../src/shared/constants'

const scratch = { folder: '', bundle: '' }
const PROCESSES = 6
const ROUNDS = 8
// Darwin sockaddr_un has 103 usable bytes; /tmp is independent of TMPDIR.
const MACOS_SOCKET_PATH_CHARS = 103

beforeAll(async () => {
  scratch.folder = await mkdtemp(path.join(path.resolve('temp'), 'named-lock-race-'))
  scratch.bundle = path.join(scratch.folder, 'namedLock.cjs')
  await build({
    entryPoints: [path.resolve('src/runtime/namedLock.ts')],
    outfile: scratch.bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
})

afterAll(async () => {
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

interface Summary {
  readonly processes: number
  readonly rounds: number
  readonly entered: number
  readonly violations: number
  readonly failures: readonly string[]
  readonly crashed: number
}

describe('the named lock under a race (R2)', () => {
  it(`never lets two of ${String(PROCESSES)} processes hold at once, on dead socket files or a pipe`, async () => {
    const driver = spawn(
      process.execPath,
      [
        path.resolve('test/hosts/named-lock-race.mjs'),
        scratch.bundle,
        path.join(scratch.folder, 'work'),
        String(PROCESSES),
        String(ROUNDS),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let output = ''
    driver.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const [code] = await once(driver, 'exit')
    const summary = JSON.parse(output) as Summary
    expect(summary.violations, 'two holders inside the protected work at once').toBe(0)
    expect(summary.failures).toEqual([])
    expect(summary.crashed).toBe(0)
    // Every process got the lock in every round: nobody starved or was refused.
    expect(summary.entered).toBe(PROCESSES * ROUNDS)
    expect(code).toBe(0)
  }, 180_000)

  it.runIf(process.platform !== 'win32')(
    'never removes an unlistening entry of a live process, regardless of age',
    async () => {
      const directory = await mkdtemp('/tmp/muse-live-entry-')
      const names = { pipe: 'unused', folder: 'unused', file: 'entry' }
      const other = path.join(directory, `entry.${String(process.pid)}.abcdef`)
      try {
        await writeFile(other, 'a not-yet-listening entry')
        await utimes(other, new Date(0), new Date(0))
        await withNamedLock(
          async () => {
            const found = await lstat(other)
            expect(found.isFile()).toBe(true)
          },
          names,
          { directory },
        )
        const kept = await lstat(other)
        expect(kept.isFile()).toBe(true)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'refuses permissive and symlinked lock directories',
    async () => {
      const directory = await mkdtemp('/tmp/muse-unsafe-entry-')
      const names = { pipe: 'unused', folder: 'unused', file: 'entry' }
      let isEntered = false
      const work = () => {
        isEntered = true
        return Promise.resolve()
      }
      try {
        const permissive = path.join(directory, 'public')
        await mkdir(permissive)
        await chmod(permissive, 0o777)
        await expect(withNamedLock(work, names, { directory: permissive })).rejects.toMatchObject({
          reason: 'unsafe-directory',
        })
        const linked = path.join(directory, 'linked')
        await symlink(permissive, linked)
        await expect(withNamedLock(work, names, { directory: linked })).rejects.toMatchObject({
          reason: 'unsafe-directory',
        })
        expect(isEntered).toBe(false)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'uses one short default root even with an overlong TMPDIR',
    async () => {
      const prior = process.env['TMPDIR']
      const folder = `muse-path-${randomUUID()}`
      const directory = path.join('/tmp', folder)
      try {
        process.env['TMPDIR'] = `/tmp/${'long'.repeat(60)}`
        await withNamedLock(
          async () => {
            const found = await lstat(directory)
            expect(found.isDirectory()).toBe(true)
          },
          { pipe: 'unused', folder, file: 'entry' },
        )
      } finally {
        if (prior === undefined) delete process.env['TMPDIR']
        else process.env['TMPDIR'] = prior
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it("keeps every lock's socket path inside macOS's limit, with the longest file name a lock makes", () => {
    const scope = 'a'.repeat(CHATGPT_GRANT_LOCK_SCOPE_CHARS)
    const entry = 'f'.repeat(NAMED_LOCK_ENTRY_BYTES * 2)
    const pid = '2147483647'
    const grant = `/tmp/${CHATGPT_GRANT_LOCK_DIR}-${scope}/${CHATGPT_GRANT_LOCK_FILE}.${pid}.${entry}`
    const keystore = `/tmp/${KEYSTORE_LOCK_DIR}-${scope}/${'b'.repeat(KEYSTORE_LOCK_ACCOUNT_CHARS)}.lock.${pid}.${entry}`
    for (const full of [grant, keystore]) {
      expect(Buffer.byteLength(full), full).toBeLessThan(MACOS_SOCKET_PATH_CHARS)
    }
  })
})
