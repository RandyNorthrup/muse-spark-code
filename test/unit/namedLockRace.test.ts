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
import { mkdtemp, rm } from 'node:fs/promises'
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
// A Unix socket path holds 103 characters on macOS; its usual temp folder takes 48 (measured: /var/folders/xx/<30>/T).
const MACOS_SOCKET_PATH_CHARS = 103
const MACOS_TMPDIR_CHARS = 48

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

  it("keeps every lock's socket path inside macOS's limit, with the longest file name a lock makes", () => {
    const scope = 'a'.repeat(CHATGPT_GRANT_LOCK_SCOPE_CHARS)
    const entry = 'f'.repeat(NAMED_LOCK_ENTRY_BYTES * 2)
    const grant = `${CHATGPT_GRANT_LOCK_DIR}-${scope}/${CHATGPT_GRANT_LOCK_FILE}.${entry}`
    const keystore = `${KEYSTORE_LOCK_DIR}-${scope}/${'b'.repeat(KEYSTORE_LOCK_ACCOUNT_CHARS)}.lock.${entry}`
    for (const relative of [grant, keystore]) {
      const full = MACOS_TMPDIR_CHARS + 1 + relative.length
      expect(full, relative).toBeLessThan(MACOS_SOCKET_PATH_CHARS)
    }
  })
})
