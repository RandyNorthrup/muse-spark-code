import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeChildEnvironment } from '../../src/core/executables'
import { startBlobHold, type BlobHoldStart } from '../../src/core/judge/fast/blobHold'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'
import { inspectStart } from './helpers/inspectStart'

const isLinux = process.platform === 'linux'

// The runner has no ambient spawn fallback: with a launcher that refuses,
// nothing runs and the refusal reaches the caller verbatim.
const refusingStart: BlobHoldStart = () => Promise.reject(new Error('admission refused'))

/** Live processes whose command line names the marker; SIGKILLed best-effort. */
const reapOrphans = (marker: string): number[] => {
  const found: number[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/u.test(entry)) continue
    let cmdline: string
    try {
      cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
    } catch {
      // The process exited mid-scan.
      continue
    }
    if (!cmdline.includes(marker)) continue
    const pid = Number(entry)
    found.push(pid)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone; the scan still reports it.
    }
  }
  return found
}

describe('blob hold broker', () => {
  it('propagates a launcher failure instead of inventing a hold', async () => {
    await expect(
      startBlobHold('unused', ['unused'], refusingStart, {
        cwd: '.',
        env: probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' }),
      }),
    ).rejects.toThrow('admission refused')
  })
})

describe.skipIf(!isLinux)('blob hold drills', () => {
  let scratch = ''
  let binary = ''
  let slow = ''

  // The C compiles measured ~7 s on linuxlt at load 4.4, so the default
  // hook budget flakes on a loaded runner: this hook carries the shared
  // fixture-build budget, and every build runs under an inner timeout that
  // fails the suite with this sentence instead of leaving the tests skipped.
  beforeAll(async () => {
    try {
      scratch = await mkdtemp(path.join(os.tmpdir(), 'blobhold-'))
      execFileSync(process.execPath, ['scripts/build-blobhold.mjs'], {
        env: { PATH: '/usr/bin:/bin' },
        timeout: 100_000,
      })
      binary = path.resolve('temp/blobhold/muse-blobhold')
      slow = path.join(scratch, 'blobHoldSlow')
      execFileSync(
        '/usr/bin/cc',
        [
          '-std=c11',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wconversion',
          '-Wshadow',
          'test/unit/helpers/blobHoldSlow.c',
          '-o',
          slow,
        ],
        { env: { PATH: '/usr/bin:/bin' }, timeout: 100_000 },
      )
    } catch (error) {
      throw new Error('Blob hold test setup failed: the holder and slow variant did not build', {
        cause: error,
      })
    }
  }, FIXTURE_HOOK_TIMEOUT_MS)
  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  const blob = (name: string, content: string): string => {
    const file = path.join(scratch, name)
    writeFileSync(file, content)
    return file
  }

  it('holds blobs across ping round-trips and stops clean', async () => {
    const first = blob('first.blob', 'first-bytes')
    const second = blob('second.blob', 'second-bytes')
    const result = await startBlobHold(binary, [first, second], inspectStart, {
      cwd: scratch,
      env: probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' }),
    })
    expect(result.kind).toBe('held')
    if (result.kind !== 'held') return
    expect(result.hold.blobs).toBe(2)
    expect(await result.hold.ping()).toBe(true)
    expect(await result.hold.ping()).toBe(true)
    const exit = await result.hold.stop()
    expect(exit.exitCode).toBe(0)
    expect(readFileSync(first, 'utf8')).toBe('first-bytes')
    expect(readFileSync(second, 'utf8')).toBe('second-bytes')
  })

  it('survives a holder break: the blobs stay intact and a new hold starts', async () => {
    const file = blob('break.blob', 'break-bytes')
    const env = probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' })
    const broken = await startBlobHold(binary, [file], inspectStart, { cwd: scratch, env })
    expect(broken.kind).toBe('held')
    if (broken.kind !== 'held') return
    if (broken.hold.pid === undefined) throw new Error('Holder started without a pid')
    process.kill(broken.hold.pid, 'SIGKILL')
    const exit = await broken.hold.exited
    expect(exit.signalCode).toBe('SIGKILL')
    expect(await broken.hold.ping()).toBe(false)
    expect(await broken.hold.stop()).toEqual(exit)
    expect(readFileSync(file, 'utf8')).toBe('break-bytes')
    const respawned = await startBlobHold(binary, [file], inspectStart, { cwd: scratch, env })
    expect(respawned.kind).toBe('held')
    if (respawned.kind !== 'held') return
    expect(await respawned.hold.ping()).toBe(true)
    const respawnedExit = await respawned.hold.stop()
    expect(respawnedExit.exitCode).toBe(0)
  })

  it('refuses a hold that never becomes ready and leaves no holder behind', async () => {
    const file = blob('refuse.blob', 'refuse-bytes')
    // The slow variant sleeps 30 s before its ready line; the drill budget
    // is 750 ms, so a refusal must land long before the holder would speak.
    const env = probeChildEnvironment({
      PATH: '/usr/bin:/bin',
      LC_ALL: 'C',
      TZ: 'UTC0',
      BLOBHOLD_READY_DELAY_MS: '30000',
    })
    const started = Date.now()
    const result = await startBlobHold(slow, [file], inspectStart, {
      cwd: scratch,
      env,
      timeoutMs: 750,
    })
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(result).toEqual({ kind: 'refused', reason: 'readyTimeout' })
    expect(reapOrphans(slow)).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe('refuse-bytes')
    const recovered = await startBlobHold(binary, [file], inspectStart, {
      cwd: scratch,
      env: probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' }),
    })
    expect(recovered.kind).toBe('held')
    if (recovered.kind !== 'held') return
    const recoveredExit = await recovered.hold.stop()
    expect(recoveredExit.exitCode).toBe(0)
  })

  it('refuses a holder that exits before its ready line', async () => {
    const file = blob('gone.blob', 'gone-bytes')
    const result = await startBlobHold(path.join(scratch, 'no-such-holder'), [file], inspectStart, {
      cwd: scratch,
      env: probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' }),
    })
    expect(result).toEqual({ kind: 'refused', reason: 'exited' })
  })
})
